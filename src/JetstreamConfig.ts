/**
 * @since 1.0.0
 */
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { ParseError } from "./JetstreamError.js"

/**
 * @since 1.1.0
 * @category models
 */
export type JetstreamDecoder = (data: Uint8Array) => Effect.Effect<Uint8Array, ParseError>

/**
 * @since 1.2.0
 * @category models
 */
export type JetstreamRuntimeEvent =
  | {
      readonly _tag: "ConnectionAttempt"
      readonly timestampMs: number
      readonly url: string
    }
  | {
      readonly _tag: "ConnectionOpened"
      readonly timestampMs: number
      readonly url: string
    }
  | {
      readonly _tag: "ConnectionClosed"
      readonly timestampMs: number
      readonly reason: string
      readonly cause?: unknown
    }
  | {
      readonly _tag: "DecodeFailed"
      readonly timestampMs: number
      readonly message: string
    }
  | {
      readonly _tag: "InboundDropped"
      readonly timestampMs: number
      readonly kind: "commit" | "identity" | "account"
      readonly did: string
    }
  | {
      readonly _tag: "OutboundQueued"
      readonly timestampMs: number
    }
  | {
      readonly _tag: "OutboundEncoded"
      readonly timestampMs: number
    }
  | {
      readonly _tag: "OutboundEncodeFailed"
      readonly timestampMs: number
      readonly message: string
    }
  | {
      readonly _tag: "OutboundSent"
      readonly timestampMs: number
    }
  | {
      readonly _tag: "Shutdown"
      readonly timestampMs: number
    }

/**
 * @since 1.2.0
 * @category models
 */
export type JetstreamRuntimeObserver = (event: JetstreamRuntimeEvent) => Effect.Effect<void>

const JetstreamDecoderSchema = Schema.declare<JetstreamDecoder>(
  (u): u is JetstreamDecoder => typeof u === "function"
)

const JetstreamRuntimeObserverSchema = Schema.declare<JetstreamRuntimeObserver>(
  (u): u is JetstreamRuntimeObserver => typeof u === "function"
)

/**
 * @since 1.0.0
 * @category schemas
 */
export class JetstreamConfig extends Schema.Class<JetstreamConfig>("JetstreamConfig")({
  endpoint: Schema.optionalWith(Schema.String, {
    default: () => "wss://jetstream1.us-east.bsky.network/subscribe"
  }),
  wantedCollections: Schema.optionalWith(Schema.Array(Schema.String), {
    default: () => []
  }),
  wantedDids: Schema.optionalWith(Schema.Array(Schema.String), {
    default: () => []
  }),
  cursor: Schema.optional(Schema.Number),
  maxMessageSizeBytes: Schema.optional(Schema.Number),
  compress: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  decoder: Schema.optional(JetstreamDecoderSchema),
  inboundBufferSize: Schema.optionalWith(Schema.Number, { default: () => 4096 }),
  inboundBufferStrategy: Schema.optionalWith(
    Schema.Literal("suspend", "dropping", "sliding"),
    { default: () => "suspend" }
  ),
  runtimeObserver: Schema.optional(JetstreamRuntimeObserverSchema)
}) {}

/**
 * @since 1.0.0
 * @category models
 */
export interface OptionsUpdate {
  readonly wantedCollections?: ReadonlyArray<string>
  readonly wantedDids?: ReadonlyArray<string>
  readonly maxMessageSizeBytes?: number
}

/**
 * @since 1.0.0
 * @category models
 */
export interface SubscriberSourcedMessage {
  readonly type: "options_update"
  readonly payload: OptionsUpdate
}
