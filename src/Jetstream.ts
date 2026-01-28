/**
 * @since 1.0.0
 */
import type * as Socket from "@effect/platform/Socket"
import type * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import type * as Stream from "effect/Stream"
import type { JetstreamConfig, OptionsUpdate, SubscriberSourcedMessage } from "./JetstreamConfig.js"
import type { JetstreamError } from "./JetstreamError.js"
import type { JetstreamMessage } from "./JetstreamMessage.js"
import * as internal from "./internal/jetstream.js"

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
export const Jetstream: typeof internal.tag = internal.tag

/**
 * @since 1.0.0
 * @category layers
 */
export const layer: (
  config: JetstreamConfig
) => Layer.Layer<Jetstream, JetstreamError, Socket.WebSocketConstructor> = internal.layer

/**
 * @since 1.0.0
 * @category layers
 */
export const live: (
  config: JetstreamConfig
) => Layer.Layer<Jetstream, JetstreamError> = internal.live
