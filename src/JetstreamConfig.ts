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
      readonly _tag: "IngressDropped"
      readonly timestampMs: number
      readonly sizeBytes: number
      readonly chunkType: "text" | "binary"
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

const PositiveInteger = Schema.Number.pipe(
  Schema.finite(),
  Schema.int(),
  Schema.greaterThan(0)
)

const JitterFactor = Schema.Number.pipe(
  Schema.finite(),
  Schema.between(0, 1)
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
  ingressBufferSize: Schema.optionalWith(Schema.Number, { default: () => 4096 }),
  ingressBufferStrategy: Schema.optionalWith(
    Schema.Literal("suspend", "dropping", "sliding"),
    { default: () => "dropping" }
  ),
  outboundBufferSize: Schema.optionalWith(PositiveInteger, { default: () => 1024 }),
  reconnectBaseDelayMs: Schema.optionalWith(PositiveInteger, { default: () => 1000 }),
  reconnectMaxDelayMs: Schema.optionalWith(PositiveInteger, { default: () => 30000 }),
  reconnectJitterFactor: Schema.optionalWith(JitterFactor, { default: () => 0 }),
  runtimeObserverBufferSize: Schema.optionalWith(Schema.Number, { default: () => 1024 }),
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
