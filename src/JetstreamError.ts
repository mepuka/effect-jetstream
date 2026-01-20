/**
 * @since 1.0.0
 */
import * as Schema from "effect/Schema"

/**
 * @since 1.0.0
 * @category symbols
 */
export const TypeId: unique symbol = Symbol.for("effect-jetstream/JetstreamError")

/**
 * @since 1.0.0
 * @category symbols
 */
export type TypeId = typeof TypeId

/**
 * @since 1.0.0
 * @category errors
 */
export class ConnectionError extends Schema.TaggedError<ConnectionError>()(
  "ConnectionError",
  {
    reason: Schema.Literal("Connect", "Timeout", "Closed", "Reconnecting"),
    cause: Schema.optional(Schema.Unknown)
  }
) {
  readonly [TypeId]: TypeId = TypeId

  override get message(): string {
    return `Connection ${this.reason}${this.cause ? `: ${this.cause}` : ""}`
  }
}

/**
 * @since 1.0.0
 * @category errors
 */
export class ParseError extends Schema.TaggedError<ParseError>()(
  "ParseError",
  {
    message: Schema.String,
    raw: Schema.optional(Schema.String)
  }
) {
  readonly [TypeId]: TypeId = TypeId
}

/**
 * @since 1.0.0
 * @category errors
 */
export class SubscriptionError extends Schema.TaggedError<SubscriptionError>()(
  "SubscriptionError",
  {
    reason: Schema.Literal("InvalidCursor", "TooManyCollections", "TooManyDids")
  }
) {
  readonly [TypeId]: TypeId = TypeId

  override get message(): string {
    return `Subscription error: ${this.reason}`
  }
}

/**
 * @since 1.0.0
 * @category types
 */
export type JetstreamError = ConnectionError | ParseError | SubscriptionError
