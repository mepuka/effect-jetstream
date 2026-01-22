/**
 * @since 1.0.0
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import {
  Block,
  Follow,
  Like,
  Post,
  Profile,
  Repost,
  type Collection,
  type RecordFor
} from "../BlueskyRecord.js"
import { ParseError, type JetstreamError } from "../JetstreamError.js"
import type {
  CommitCreate,
  CommitDelete,
  CommitUpdate,
  EventFor,
  EventKind,
  JetstreamMessage
} from "../JetstreamMessage.js"
import { tag as JetstreamTag, type Jetstream } from "./jetstream.js"
import { summarizeParseError } from "./parseError.js"

/**
 * @since 1.0.0
 * @category symbols
 */
export const TypeId: unique symbol = Symbol.for("effect-jetstream/JetstreamClient")

/**
 * @since 1.0.0
 * @category symbols
 */
export type TypeId = typeof TypeId

/**
 * @since 1.0.0
 * @category models
 */
export interface JetstreamClient {
  readonly [TypeId]: TypeId
  readonly onCreate: <C extends Collection>(
    collection: C,
    handler: (event: CommitCreate & { readonly commit: { readonly record: RecordFor<C> } }) => Effect.Effect<void>
  ) => Effect.Effect<void>
  readonly onUpdate: <C extends Collection>(
    collection: C,
    handler: (event: CommitUpdate & { readonly commit: { readonly record: RecordFor<C> } }) => Effect.Effect<void>
  ) => Effect.Effect<void>
  readonly onDelete: <C extends Collection>(
    collection: C,
    handler: (event: CommitDelete) => Effect.Effect<void>
  ) => Effect.Effect<void>
  readonly on: <K extends EventKind>(
    kind: K,
    handler: (event: EventFor<K>) => Effect.Effect<void>
  ) => Effect.Effect<void>
  readonly run: Effect.Effect<never, JetstreamError>
}

/**
 * @since 1.0.0
 * @category tags
 */
export const tag = Context.GenericTag<JetstreamClient>("effect-jetstream/JetstreamClient")

type Handler = (event: JetstreamMessage) => Effect.Effect<void>

const recordSchemas = {
  "app.bsky.feed.post": Post,
  "app.bsky.feed.like": Like,
  "app.bsky.feed.repost": Repost,
  "app.bsky.graph.follow": Follow,
  "app.bsky.graph.block": Block,
  "app.bsky.actor.profile": Profile
} satisfies Record<Collection, Schema.Schema<any, any, never>>

const decodeRecord = <C extends Collection>(
  collection: C,
  record: unknown
): Effect.Effect<RecordFor<C>, ParseError> => {
  const schema = recordSchemas[collection] as unknown as Schema.Schema<RecordFor<C>, any, never>
  return Schema.decodeUnknown(schema)(record).pipe(
    Effect.mapError((error) => new ParseError({
      message: `Record schema validation failed for ${collection}: ${summarizeParseError(error)}`
    }))
  )
}

const eventContext = (event: JetstreamMessage): Record<string, unknown> => {
  if (event._tag === "CommitCreate" || event._tag === "CommitUpdate" || event._tag === "CommitDelete") {
    return {
      kind: event.kind,
      did: event.did,
      collection: event.commit.collection,
      rkey: event.commit.rkey
    }
  }
  return {
    kind: event.kind,
    did: event.did
  }
}

const logHandlerFailure = (label: string, event: JetstreamMessage) =>
  (cause: unknown) =>
    Effect.logWarning("Jetstream handler failed", {
      handler: label,
      ...eventContext(event),
      cause
    })

const logRecordFailure = (collection: Collection, error: ParseError, event: JetstreamMessage) =>
  Effect.logWarning("Dropping malformed record", {
    collection,
    ...eventContext(event),
    message: error.message
  })

/**
 * @since 1.0.0
 * @category layers
 */
export const layer: Layer.Layer<JetstreamClient, never, Jetstream> = Layer.effect(
  tag,
  Effect.gen(function* () {
    const jetstream = yield* JetstreamTag
    const handlers = yield* Ref.make<ReadonlyArray<Handler>>([])

    const addHandler = (handler: Handler): Effect.Effect<void> =>
      Ref.update(handlers, (current) => [...current, handler])

    const onCreate = Effect.fn("JetstreamClient.onCreate")(
      <C extends Collection>(
        collection: C,
        handler: (event: CommitCreate & { readonly commit: { readonly record: RecordFor<C> } }) => Effect.Effect<void>
      ): Effect.Effect<void> =>
        addHandler((event) => {
          if (event._tag !== "CommitCreate" || event.commit.collection !== collection) {
            return Effect.void
          }
          return decodeRecord(collection, event.commit.record).pipe(
            Effect.matchEffect({
              onFailure: (error) => logRecordFailure(collection, error, event),
              onSuccess: (record) =>
                handler({
                  ...event,
                  commit: {
                    ...event.commit,
                    record
                  }
                }).pipe(Effect.catchAllCause(logHandlerFailure("onCreate", event)))
            })
          )
        })
    )

    const onUpdate = Effect.fn("JetstreamClient.onUpdate")(
      <C extends Collection>(
        collection: C,
        handler: (event: CommitUpdate & { readonly commit: { readonly record: RecordFor<C> } }) => Effect.Effect<void>
      ): Effect.Effect<void> =>
        addHandler((event) => {
          if (event._tag !== "CommitUpdate" || event.commit.collection !== collection) {
            return Effect.void
          }
          return decodeRecord(collection, event.commit.record).pipe(
            Effect.matchEffect({
              onFailure: (error) => logRecordFailure(collection, error, event),
              onSuccess: (record) =>
                handler({
                  ...event,
                  commit: {
                    ...event.commit,
                    record
                  }
                }).pipe(Effect.catchAllCause(logHandlerFailure("onUpdate", event)))
            })
          )
        })
    )

    const onDelete = Effect.fn("JetstreamClient.onDelete")(
      <C extends Collection>(
        collection: C,
        handler: (event: CommitDelete) => Effect.Effect<void>
      ): Effect.Effect<void> =>
        addHandler((event) => {
          if (event._tag !== "CommitDelete" || event.commit.collection !== collection) {
            return Effect.void
          }
          return handler(event).pipe(Effect.catchAllCause(logHandlerFailure("onDelete", event)))
        })
    )

    const on = Effect.fn("JetstreamClient.on")(
      <K extends EventKind>(
        kind: K,
        handler: (event: EventFor<K>) => Effect.Effect<void>
      ): Effect.Effect<void> =>
        addHandler((event) => {
          if (event.kind !== kind) {
            return Effect.void
          }
          return handler(event as EventFor<K>).pipe(
            Effect.catchAllCause(logHandlerFailure("on", event))
          )
        })
    )

    const dispatchEvent = Effect.fn("JetstreamClient.dispatchEvent")(
      (event: JetstreamMessage): Effect.Effect<void> =>
        Ref.get(handlers).pipe(
          Effect.flatMap((current) =>
            Effect.forEach(
              current,
              (handler) => handler(event),
              { discard: true }
            )
          )
        )
    )

    const run = jetstream.stream.pipe(
      Stream.runForEach(dispatchEvent),
      Effect.zipRight(Effect.never)
    )

    return tag.of({
      [TypeId]: TypeId,
      onCreate,
      onUpdate,
      onDelete,
      on,
      run
    })
  })
)
