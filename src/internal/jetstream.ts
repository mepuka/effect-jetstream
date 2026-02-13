/**
 * @since 1.0.0
 */
import * as Socket from "@effect/platform/Socket"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Mailbox from "effect/Mailbox"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type {
  JetstreamConfig,
  JetstreamDecoder,
  JetstreamRuntimeEvent,
  OptionsUpdate,
  SubscriberSourcedMessage
} from "../JetstreamConfig.js"
import { ConnectionError, ParseError, type JetstreamError } from "../JetstreamError.js"
import type { JetstreamMessage } from "../JetstreamMessage.js"
import { decodeMessage } from "./decoder.js"
import { summarizeParseError } from "./parseError.js"
import { buildUrl, createSocket } from "./websocket.js"

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
  readonly shutdown: Effect.Effect<void>
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

const OptionsUpdateSchema = Schema.Struct({
  wantedCollections: Schema.optional(Schema.Array(Schema.String)),
  wantedDids: Schema.optional(Schema.Array(Schema.String)),
  maxMessageSizeBytes: Schema.optional(Schema.Number)
})

const SubscriberSourcedMessageSchema = Schema.Struct({
  type: Schema.Literal("options_update"),
  payload: OptionsUpdateSchema
})

const encodeOutboundMessage = Schema.encode(
  Schema.parseJson(SubscriberSourcedMessageSchema)
)

type BunRuntime = {
  readonly zstdDecompress?: (data: Uint8Array) => Uint8Array | PromiseLike<Uint8Array>
}

type ResolvedDecoder = {
  readonly decoder: JetstreamDecoder | undefined
  readonly usingDefaultDecoder: boolean
}

const makeDefaultZstdDecoder = (
  zstdDecompress: NonNullable<BunRuntime["zstdDecompress"]>
): JetstreamDecoder =>
  (data) =>
    Effect.tryPromise({
      try: () => Promise.resolve(zstdDecompress(data)),
      catch: (error) =>
        new ParseError({
          message: `Zstd decompression failed: ${String(error)}`
        })
    })

const resolveDecoder = (config: JetstreamConfig): Effect.Effect<ResolvedDecoder, ParseError> => {
  if (!config.compress) {
    return Effect.succeed({
      decoder: undefined,
      usingDefaultDecoder: false
    })
  }
  if (config.decoder !== undefined) {
    return Effect.succeed({
      decoder: config.decoder,
      usingDefaultDecoder: false
    })
  }
  const bunRuntime = (globalThis as { readonly Bun?: BunRuntime }).Bun
  if (bunRuntime?.zstdDecompress !== undefined) {
    return Effect.succeed({
      decoder: makeDefaultZstdDecoder(bunRuntime.zstdDecompress),
      usingDefaultDecoder: true
    })
  }
  return Effect.fail(new ParseError({
    message: "Jetstream compression requires a custom decoder when Bun.zstdDecompress is unavailable."
  }))
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
      const url = yield* buildUrl(config)
      const scope = yield* Effect.scope
      const mailbox = yield* Mailbox.make<JetstreamMessage, JetstreamError>({
        capacity: config.inboundBufferSize,
        strategy: config.inboundBufferStrategy
      })
      const outbound = yield* Queue.bounded<OutboundMessage>(outboundBufferSize)
      const pending = yield* Ref.make<Option.Option<OutboundMessage>>(Option.none())
      const shutdownSignal = yield* Deferred.make<void>()
      const { decoder, usingDefaultDecoder } = yield* resolveDecoder(config)
      const now = () => Date.now()
      const emitRuntimeEvent = Effect.fn("Jetstream.emitRuntimeEvent")(
        (event: JetstreamRuntimeEvent): Effect.Effect<void> =>
          config.runtimeObserver === undefined
            ? Effect.void
            : config.runtimeObserver(event).pipe(
              Effect.catchAllCause(() => Effect.void),
              Effect.forkDaemon,
              Effect.asVoid
            )
      )

      if (usingDefaultDecoder) {
        yield* Effect.logWarning(
          "Jetstream compression enabled without a custom decoder; using Bun.zstdDecompress without a dictionary."
        )
      }

      const logDecodeError = (error: ParseError) =>
        emitRuntimeEvent({
          _tag: "DecodeFailed",
          timestampMs: now(),
          message: error.message
        }).pipe(
          Effect.zipRight(
            Effect.logWarning("Dropping malformed Jetstream message", {
              message: error.message,
              raw: error.raw
            })
          )
        )

      const handleIncoming = Effect.fn("Jetstream.handleIncoming")(
        (data: string | Uint8Array) =>
          decodeMessage(data, decoder).pipe(
            Effect.flatMap((message) =>
              mailbox.offer(message).pipe(
                Effect.flatMap((accepted) =>
                  accepted
                    ? Effect.void
                    : emitRuntimeEvent({
                      _tag: "InboundDropped",
                      timestampMs: now(),
                      kind: message.kind,
                      did: message.did
                    }).pipe(
                      Effect.zipRight(
                        Effect.logDebug("Dropping Jetstream message because inbound buffer is full", {
                          kind: message.kind,
                          did: message.did
                        })
                      )
                    )
                )
              )
            ),
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
          const encoded = yield* encodeOutboundMessage(next.message).pipe(
            Effect.mapError((error) =>
              new ParseError({
                message: `Failed to serialize outbound message: ${summarizeParseError(error)}`
              })
            ),
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                yield* emitRuntimeEvent({
                  _tag: "OutboundEncodeFailed",
                  timestampMs: now(),
                  message: error.message
                })
                yield* Ref.set(pending, Option.none())
                yield* Deferred.fail(next.done, error)
                return yield* Effect.fail(error)
              })
            )
          )
          yield* emitRuntimeEvent({
            _tag: "OutboundEncoded",
            timestampMs: now()
          })
          yield* writer(encoded).pipe(
            Effect.mapError((cause) => new ConnectionError({ reason: "Closed", cause }))
          )
          yield* emitRuntimeEvent({
            _tag: "OutboundSent",
            timestampMs: now()
          })
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
          yield* emitRuntimeEvent({
            _tag: "ConnectionAttempt",
            timestampMs: now(),
            url
          })
          const socket = yield* createSocket(url)
          yield* emitRuntimeEvent({
            _tag: "ConnectionOpened",
            timestampMs: now(),
            url
          })
          const writer = yield* socket.writer
          yield* Effect.raceFirst(readLoop(socket), writeLoop(writer))
        })
      ).pipe(
        Effect.tapError((error) =>
          error._tag === "ConnectionError"
            ? emitRuntimeEvent({
              _tag: "ConnectionClosed",
              timestampMs: now(),
              reason: error.reason,
              ...(error.cause === undefined ? {} : { cause: error.cause })
            })
            : Effect.void
        ),
        Effect.retry(reconnectSchedule)
      )

      const runConnectionUntilShutdown = Effect.raceFirst(
        runConnection,
        Deferred.await(shutdownSignal)
      ).pipe(
        Effect.catchAllCause((cause) =>
          Cause.isInterrupted(cause)
            ? Effect.void
            : Effect.failCause(cause)
        )
      )

      const connectionFiber = yield* Effect.forkIn(runConnectionUntilShutdown, scope)

      const shutdown = Effect.uninterruptible(
        Effect.gen(function* () {
          yield* emitRuntimeEvent({
            _tag: "Shutdown",
            timestampMs: now()
          })
          yield* Deferred.succeed(shutdownSignal, undefined)
          yield* Fiber.interrupt(connectionFiber)
          const closed = new ConnectionError({
            reason: "Closed",
            cause: "Jetstream shutdown"
          })
          const pendingValue = yield* Ref.get(pending)
          if (Option.isSome(pendingValue)) {
            yield* Deferred.fail(pendingValue.value.done, closed)
            yield* Ref.set(pending, Option.none())
          }
          const remaining = yield* Queue.takeAll(outbound)
          for (const item of remaining) {
            yield* Deferred.fail(item.done, closed)
          }
          yield* mailbox.end
        })
      )

      yield* Scope.addFinalizer(scope, shutdown)

      const send = Effect.fn("Jetstream.send")(
        (message: SubscriberSourcedMessage): Effect.Effect<void, JetstreamError> =>
          Effect.gen(function* () {
            const isShutdown = yield* Deferred.isDone(shutdownSignal)
            if (isShutdown) {
              return yield* Effect.fail(new ConnectionError({ reason: "Closed", cause: "Jetstream shutdown" }))
            }
            const done = yield* Deferred.make<void, JetstreamError>()
            const accepted = yield* Effect.raceFirst(
              Queue.offer(outbound, { message, done }),
              Deferred.await(shutdownSignal).pipe(Effect.as(false))
            )
            if (!accepted) {
              return yield* Effect.fail(new ConnectionError({ reason: "Closed", cause: "Jetstream shutdown" }))
            }
            yield* emitRuntimeEvent({
              _tag: "OutboundQueued",
              timestampMs: now()
            })
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
        updateOptions,
        shutdown
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
