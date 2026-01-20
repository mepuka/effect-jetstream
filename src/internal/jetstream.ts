/**
 * @since 1.0.0
 */
import * as Socket from "@effect/platform/Socket"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Mailbox from "effect/Mailbox"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type { JetstreamConfig, JetstreamDecoder, OptionsUpdate, SubscriberSourcedMessage } from "../JetstreamConfig.js"
import { ConnectionError, ParseError, type JetstreamError } from "../JetstreamError.js"
import type { JetstreamMessage } from "../JetstreamMessage.js"
import { decodeMessage } from "./decoder.js"
import { buildUrl } from "./websocket.js"

/**
 * @since 1.0.0
 * @category symbols
 */
export const TypeId: unique symbol = Symbol.for("effect-jetstream/Jetstream")

/**
 * @since 1.0.0
 * @category symbols
 */
export type TypeId = typeof TypeId

/**
 * @since 1.0.0
 * @category models
 */
export interface Jetstream {
  readonly [TypeId]: TypeId
  readonly stream: Stream.Stream<JetstreamMessage, JetstreamError>
  readonly send: (message: SubscriberSourcedMessage) => Effect.Effect<void, JetstreamError>
  readonly updateOptions: (options: OptionsUpdate) => Effect.Effect<void, JetstreamError>
}

/**
 * @since 1.0.0
 * @category tags
 */
export const tag = Context.GenericTag<Jetstream>("effect-jetstream/Jetstream")

const reconnectSchedule = Schedule.exponential("1 second").pipe(
  Schedule.union(Schedule.spaced("30 seconds"))
)

const outboundBufferSize = 1024

type OutboundMessage = {
  readonly message: SubscriberSourcedMessage
  readonly done: Deferred.Deferred<void, JetstreamError>
}

const defaultZstdDecoder: JetstreamDecoder = (data) =>
  Effect.tryPromise({
    try: () => Bun.zstdDecompress(data),
    catch: (error) =>
      new ParseError({
        message: `Zstd decompression failed: ${String(error)}`
      })
  })

const resolveDecoder = (config: JetstreamConfig): JetstreamDecoder | undefined => {
  if (!config.compress) {
    return undefined
  }
  return config.decoder ?? defaultZstdDecoder
}

/**
 * @since 1.0.0
 * @category layers
 */
export const layer = (
  config: JetstreamConfig
): Layer.Layer<Jetstream, JetstreamError, Socket.WebSocketConstructor> =>
  Layer.scoped(
    tag,
    Effect.gen(function* () {
      const url = buildUrl(config)
      const scope = yield* Effect.scope
      const mailbox = yield* Mailbox.make<JetstreamMessage, JetstreamError>()
      const outbound = yield* Queue.bounded<OutboundMessage>(outboundBufferSize)
      const pending = yield* Ref.make<Option.Option<OutboundMessage>>(Option.none())
      const decoder = resolveDecoder(config)

      if (config.compress && config.decoder === undefined) {
        yield* Effect.logWarning(
          "Jetstream compression enabled without a custom decoder; using Bun.zstdDecompress without a dictionary."
        )
      }

      const shutdown = Effect.gen(function* () {
        const closed = new ConnectionError({
          reason: "Closed",
          cause: "Jetstream shutdown"
        })
        const pendingValue = yield* Ref.get(pending)
        if (Option.isSome(pendingValue)) {
          yield* Deferred.fail(pendingValue.value.done, closed)
        }
        const remaining = yield* Queue.takeAll(outbound)
        for (const item of remaining) {
          yield* Deferred.fail(item.done, closed)
        }
        yield* Queue.shutdown(outbound)
        yield* mailbox.end
      })

      yield* Scope.addFinalizer(scope, shutdown)

      const logDecodeError = (error: ParseError) =>
        Effect.logWarning("Dropping malformed Jetstream message", {
          message: error.message,
          raw: error.raw
        })

      const handleIncoming = Effect.fn("Jetstream.handleIncoming")(
        (data: string | Uint8Array) =>
          decodeMessage(data, decoder).pipe(
            Effect.flatMap((message) => mailbox.offer(message)),
            Effect.asVoid,
            Effect.catchAll(logDecodeError)
          )
      )

      const takeNextOutbound = Effect.uninterruptibleMask((restore) =>
        Ref.get(pending).pipe(
          Effect.flatMap((pendingValue) => {
            if (Option.isSome(pendingValue)) {
              return Effect.succeed(pendingValue.value)
            }
            return restore(Queue.take(outbound)).pipe(
              Effect.flatMap((next) =>
                Effect.uninterruptible(Ref.set(pending, Option.some(next))).pipe(
                  Effect.as(next)
                )
              )
            )
          })
        )
      )

      const writeOne = (writer: (chunk: Uint8Array | string | Socket.CloseEvent) => Effect.Effect<void, Socket.SocketError>) =>
        Effect.gen(function* () {
          const next = yield* takeNextOutbound
          yield* writer(JSON.stringify(next.message)).pipe(
            Effect.mapError((cause) => new ConnectionError({ reason: "Closed", cause }))
          )
          yield* Ref.set(pending, Option.none())
          yield* Deferred.succeed(next.done, undefined)
        })

      const writeLoop = (writer: (chunk: Uint8Array | string | Socket.CloseEvent) => Effect.Effect<void, Socket.SocketError>) =>
        writeOne(writer).pipe(Effect.forever)

      const readLoop = (socket: Socket.Socket) =>
        socket.runRaw((data) => handleIncoming(data)).pipe(
          Effect.catchAll((cause) => Effect.fail(new ConnectionError({ reason: "Closed", cause }))),
          Effect.zipRight(Effect.fail(new ConnectionError({ reason: "Closed", cause: "Socket closed" })))
        )

      const runConnection = Effect.scoped(
        Effect.gen(function* () {
          const socket = yield* Socket.makeWebSocket(url)
          const writer = yield* socket.writer
          yield* Effect.raceFirst(readLoop(socket), writeLoop(writer))
        })
      ).pipe(
        Effect.retry(reconnectSchedule)
      )

      yield* Effect.forkIn(runConnection, scope)

      const send = Effect.fn("Jetstream.send")(
        (message: SubscriberSourcedMessage): Effect.Effect<void, JetstreamError> =>
          Effect.gen(function* () {
            const done = yield* Deferred.make<void, JetstreamError>()
            const accepted = yield* Queue.offer(outbound, { message, done })
            if (!accepted) {
              return yield* Effect.fail(new ConnectionError({ reason: "Closed", cause: "Send queue shutdown" }))
            }
            return yield* Deferred.await(done)
          })
      )

      const updateOptions = Effect.fn("Jetstream.updateOptions")(
        (options: OptionsUpdate): Effect.Effect<void, JetstreamError> =>
          send({ type: "options_update", payload: options })
      )

      return tag.of({
        [TypeId]: TypeId,
        stream: Mailbox.toStream(mailbox),
        send,
        updateOptions
      })
    })
  )

/**
 * @since 1.0.0
 * @category layers
 */
export const live = (
  config: JetstreamConfig
): Layer.Layer<Jetstream, JetstreamError> =>
  layer(config).pipe(
    Layer.provide(Socket.layerWebSocketConstructorGlobal)
  )
