/**
 * @since 1.0.0
 */
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { Did } from "../BlueskyRecord.js"
import type { JetstreamDecoder } from "../JetstreamConfig.js"
import { ParseError } from "../JetstreamError.js"
import {
  AccountEvent,
  CommitCreate,
  CommitDelete,
  CommitUpdate,
  IdentityEvent,
  type JetstreamMessage
} from "../JetstreamMessage.js"

const textDecoder = new TextDecoder()

const Commit = Schema.Struct({
  rev: Schema.String,
  operation: Schema.Literal("create", "update", "delete"),
  collection: Schema.String,
  rkey: Schema.String,
  record: Schema.optional(Schema.Unknown),
  cid: Schema.optional(Schema.String)
})

const Identity = Schema.Struct({
  did: Did,
  handle: Schema.optional(Schema.String),
  seq: Schema.Number,
  time: Schema.String
})

const Account = Schema.Struct({
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

const RawMessage = Schema.Struct({
  did: Did,
  time_us: Schema.Number,
  kind: Schema.Literal("commit", "identity", "account"),
  commit: Schema.optional(Commit),
  identity: Schema.optional(Identity),
  account: Schema.optional(Account)
})

const decodeRaw = Schema.decodeUnknown(Schema.parseJson(RawMessage))

const decodeText = (
  data: string | Uint8Array,
  decoder?: JetstreamDecoder
): Effect.Effect<string, ParseError> => {
  if (typeof data === "string") {
    return Effect.succeed(data)
  }
  if (!decoder) {
    return Effect.succeed(textDecoder.decode(data))
  }
  return decoder(data).pipe(
    Effect.map((decoded) => textDecoder.decode(decoded))
  )
}

export const decodeMessage = (
  data: string | Uint8Array,
  decoder?: JetstreamDecoder
): Effect.Effect<JetstreamMessage, ParseError> => {
  return Effect.gen(function* () {
    const text = yield* decodeText(data, decoder)

    const raw = yield* decodeRaw(text).pipe(
      Effect.mapError((e) => new ParseError({
        message: `Schema validation failed: ${e.message}`,
        raw: text.slice(0, 200)
      }))
    )

    if (raw.kind === "commit") {
      if (!raw.commit) {
        return yield* Effect.fail(new ParseError({
          message: "Missing commit payload for commit event",
          raw: text.slice(0, 200)
        }))
      }
      const { commit } = raw
      const base = {
        did: raw.did,
        time_us: raw.time_us,
        kind: "commit" as const
      }

      switch (commit.operation) {
        case "create":
          if (commit.record === undefined) {
            return yield* Effect.fail(new ParseError({
              message: "Missing record for commit create",
              raw: text.slice(0, 200)
            }))
          }
          return new CommitCreate({
            ...base,
            commit: {
              rev: commit.rev,
              operation: "create",
              collection: commit.collection,
              rkey: commit.rkey,
              record: commit.record,
              cid: commit.cid
            }
          })
        case "update":
          if (commit.record === undefined) {
            return yield* Effect.fail(new ParseError({
              message: "Missing record for commit update",
              raw: text.slice(0, 200)
            }))
          }
          return new CommitUpdate({
            ...base,
            commit: {
              rev: commit.rev,
              operation: "update",
              collection: commit.collection,
              rkey: commit.rkey,
              record: commit.record,
              cid: commit.cid
            }
          })
        case "delete":
          return new CommitDelete({
            ...base,
            commit: {
              rev: commit.rev,
              operation: "delete",
              collection: commit.collection,
              rkey: commit.rkey
            }
          })
      }
    }

    if (raw.kind === "identity") {
      if (!raw.identity) {
        return yield* Effect.fail(new ParseError({
          message: "Missing identity payload for identity event",
          raw: text.slice(0, 200)
        }))
      }
      return new IdentityEvent({
        did: raw.did,
        time_us: raw.time_us,
        kind: "identity",
        identity: raw.identity
      })
    }

    if (raw.kind === "account") {
      if (!raw.account) {
        return yield* Effect.fail(new ParseError({
          message: "Missing account payload for account event",
          raw: text.slice(0, 200)
        }))
      }
      return new AccountEvent({
        did: raw.did,
        time_us: raw.time_us,
        kind: "account",
        account: raw.account
      })
    }

    return yield* Effect.fail(new ParseError({
      message: `Unknown event kind: ${raw.kind}`,
      raw: text.slice(0, 200)
    }))
  })
}
