/**
 * @since 1.0.0
 */
import * as Schema from "effect/Schema"

/**
 * @since 1.0.0
 * @category schemas
 */
export const Did = Schema.String.pipe(
  Schema.pattern(/^did:[a-z]+:[a-zA-Z0-9._:%-]+$/),
  Schema.brand("Did")
)

/**
 * @since 1.0.0
 * @category types
 */
export type Did = typeof Did.Type

/**
 * @since 1.0.0
 * @category schemas
 */
export class StrongRef extends Schema.Class<StrongRef>("StrongRef")({
  uri: Schema.String,
  cid: Schema.String
}) {}

/**
 * @since 1.0.0
 * @category schemas
 */
export class Post extends Schema.Class<Post>("Post")({
  $type: Schema.Literal("app.bsky.feed.post"),
  text: Schema.String,
  createdAt: Schema.String,
  langs: Schema.optional(Schema.Array(Schema.String)),
  reply: Schema.optional(Schema.Struct({
    root: StrongRef,
    parent: StrongRef
  })),
  embed: Schema.optional(Schema.Unknown),
  facets: Schema.optional(Schema.Array(Schema.Unknown))
}) {}

/**
 * @since 1.0.0
 * @category schemas
 */
export class Like extends Schema.Class<Like>("Like")({
  $type: Schema.Literal("app.bsky.feed.like"),
  subject: StrongRef,
  createdAt: Schema.String
}) {}

/**
 * @since 1.0.0
 * @category schemas
 */
export class Follow extends Schema.Class<Follow>("Follow")({
  $type: Schema.Literal("app.bsky.graph.follow"),
  subject: Did,
  createdAt: Schema.String
}) {}

/**
 * @since 1.0.0
 * @category schemas
 */
export class Repost extends Schema.Class<Repost>("Repost")({
  $type: Schema.Literal("app.bsky.feed.repost"),
  subject: StrongRef,
  createdAt: Schema.String
}) {}

/**
 * @since 1.0.0
 * @category schemas
 */
export class Block extends Schema.Class<Block>("Block")({
  $type: Schema.Literal("app.bsky.graph.block"),
  subject: Did,
  createdAt: Schema.String
}) {}

/**
 * @since 1.0.0
 * @category schemas
 */
export class Profile extends Schema.Class<Profile>("Profile")({
  $type: Schema.Literal("app.bsky.actor.profile"),
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  avatar: Schema.optional(Schema.Unknown),
  banner: Schema.optional(Schema.Unknown)
}) {}

/**
 * @since 1.0.0
 * @category types
 */
export type Collection =
  | "app.bsky.feed.post"
  | "app.bsky.feed.like"
  | "app.bsky.feed.repost"
  | "app.bsky.graph.follow"
  | "app.bsky.graph.block"
  | "app.bsky.actor.profile"

/**
 * @since 1.0.0
 * @category types
 */
export type CollectionRecord = {
  "app.bsky.feed.post": Post
  "app.bsky.feed.like": Like
  "app.bsky.feed.repost": Repost
  "app.bsky.graph.follow": Follow
  "app.bsky.graph.block": Block
  "app.bsky.actor.profile": Profile
}

/**
 * @since 1.0.0
 * @category types
 */
export type RecordFor<C extends Collection> = CollectionRecord[C]
