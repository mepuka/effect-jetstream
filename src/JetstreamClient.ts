/**
 * @since 1.0.0
 */
import type * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import type { Collection, RecordFor } from "./BlueskyRecord.js"
import type { JetstreamError } from "./JetstreamError.js"
import type { CommitCreate, CommitDelete, CommitUpdate, EventFor, EventKind } from "./JetstreamMessage.js"
import * as internal from "./internal/client.js"
import type { Jetstream } from "./internal/jetstream.js"

/**
 * @since 1.0.0
 * @category symbols
 */
export const TypeId: typeof internal.TypeId = internal.TypeId

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
export const JetstreamClient: typeof internal.tag = internal.tag

/**
 * @since 1.0.0
 * @category layers
 */
export const layer: Layer.Layer<JetstreamClient, never, Jetstream> = internal.layer
