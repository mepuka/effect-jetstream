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

const JetstreamDecoderSchema = Schema.declare<JetstreamDecoder>(
  (u): u is JetstreamDecoder => typeof u === "function"
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
  decoder: Schema.optional(JetstreamDecoderSchema)
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
