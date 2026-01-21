/**
 * @since 1.0.0
 */
import * as Schema from "effect/Schema"
import { Did } from "./BlueskyRecord.js"

/**
 * @since 1.0.0
 * @category schemas
 */
export class CommitCreate extends Schema.TaggedClass<CommitCreate>()("CommitCreate", {
  did: Did,
  time_us: Schema.Number,
  kind: Schema.Literal("commit"),
  commit: Schema.Struct({
    rev: Schema.String,
    operation: Schema.Literal("create"),
    collection: Schema.String,
    rkey: Schema.String,
    record: Schema.Unknown,
    cid: Schema.optional(Schema.String)
  })
}) {}

/**
 * @since 1.0.0
 * @category schemas
 */
export class CommitUpdate extends Schema.TaggedClass<CommitUpdate>()("CommitUpdate", {
  did: Did,
  time_us: Schema.Number,
  kind: Schema.Literal("commit"),
  commit: Schema.Struct({
    rev: Schema.String,
    operation: Schema.Literal("update"),
    collection: Schema.String,
    rkey: Schema.String,
    record: Schema.Unknown,
    cid: Schema.optional(Schema.String)
  })
}) {}

/**
 * @since 1.0.0
 * @category schemas
 */
export class CommitDelete extends Schema.TaggedClass<CommitDelete>()("CommitDelete", {
  did: Did,
  time_us: Schema.Number,
  kind: Schema.Literal("commit"),
  commit: Schema.Struct({
    rev: Schema.String,
    operation: Schema.Literal("delete"),
    collection: Schema.String,
    rkey: Schema.String
  })
}) {}

/**
 * @since 1.0.0
 * @category schemas
 */
export class IdentityEvent extends Schema.TaggedClass<IdentityEvent>()("IdentityEvent", {
  did: Did,
  time_us: Schema.Number,
  kind: Schema.Literal("identity"),
  identity: Schema.Struct({
    did: Did,
    handle: Schema.optional(Schema.String),
    seq: Schema.Number,
    time: Schema.String
  })
}) {}

/**
 * @since 1.0.0
 * @category schemas
 */
export class AccountEvent extends Schema.TaggedClass<AccountEvent>()("AccountEvent", {
  did: Did,
  time_us: Schema.Number,
  kind: Schema.Literal("account"),
  account: Schema.Struct({
    active: Schema.Boolean,
    did: Did,
    seq: Schema.Number,
    time: Schema.String,
    status: Schema.optional(Schema.Literal(
      "takendown",
      "suspended",
      "deleted",
      "deactivated",
      "desynchronized",
      "throttled"
    ))
  })
}) {}

/**
 * @since 1.0.0
 * @category types
 */
export type JetstreamMessage = CommitCreate | CommitUpdate | CommitDelete | IdentityEvent | AccountEvent

/**
 * @since 1.0.0
 * @category schemas
 */
export const JetstreamMessage = Schema.Union(
  CommitCreate,
  CommitUpdate,
  CommitDelete,
  IdentityEvent,
  AccountEvent
)

/**
 * @since 1.0.0
 * @category types
 */
export type EventKind = "commit" | "identity" | "account"

/**
 * @since 1.0.0
 * @category types
 */
export type EventFor<K extends EventKind> = K extends "commit"
  ? CommitCreate | CommitUpdate | CommitDelete
  : K extends "identity"
  ? IdentityEvent
  : K extends "account"
  ? AccountEvent
  : never
