# Effect Jetstream Client Design

**Date**: 2026-01-20  
**Status**: Approved  
**Goal**: Create a pure Effect TypeScript Jetstream client library, equivalent to `@skyware/jetstream`

## Overview

Build an Effect-native client for [Bluesky Jetstream](https://github.com/bluesky-social/jetstream) - a simplified JSON event stream for the AT Protocol. The library provides both low-level Stream access and high-level PubSub-based event subscriptions.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Your Application                      │
├─────────────────────────────────────────────────────────┤
│  JetstreamClient (Service)                              │
│  ├── onCreate(collection, handler)                      │
│  ├── onUpdate(collection, handler)                      │
│  ├── onDelete(collection, handler)                      │
│  └── on(eventKind, handler)                             │
├─────────────────────────────────────────────────────────┤
│  Jetstream (Service)                                    │
│  ├── stream: Stream<JetstreamMessage, JetstreamError>   │
│  ├── send(message)                                      │
│  └── updateOptions(options)                             │
├─────────────────────────────────────────────────────────┤
│  @effect/platform Socket                                │
│  └── WebSocket connection (scoped resource)             │
├─────────────────────────────────────────────────────────┤
│  Schemas                                                │
│  ├── JetstreamMessage (CommitCreate, IdentityEvent...)  │
│  └── BlueskyRecord (Post, Like, Follow...)              │
└─────────────────────────────────────────────────────────┘
```

## Module Structure

```
src/
├── index.ts                      # Re-exports all public modules
├── Jetstream.ts                  # Low-level Stream service (Tag, layer, accessors)
├── JetstreamClient.ts            # High-level PubSub service
├── JetstreamConfig.ts            # Configuration schema
├── JetstreamError.ts             # Error types
├── JetstreamMessage.ts           # Event schemas
├── BlueskyRecord.ts              # Bluesky record schemas
└── internal/
    ├── jetstream.ts              # Core implementation
    ├── client.ts                 # PubSub client implementation
    ├── websocket.ts              # WebSocket connection handling
    └── decoder.ts                # Message decoding
```

## Dependencies

- `effect` - Core Effect library
- `@effect/platform` - Socket/WebSocket handling
- Runtime requires a WebSocket constructor; `Jetstream.live` uses the global `WebSocket`, or provide `Socket.WebSocketConstructor` via `Jetstream.layer`.

## Service Definitions

### JetstreamConfig

```typescript
export type JetstreamDecoder = (data: Uint8Array) => Effect.Effect<Uint8Array, ParseError>

export class JetstreamConfig extends Schema.Class<JetstreamConfig>("JetstreamConfig")({
  endpoint: Schema.optionalWith(Schema.String, { 
    default: () => "wss://jetstream1.us-east.bsky.network/subscribe" 
  }),
  wantedCollections: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }),
  wantedDids: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }),
  cursor: Schema.optional(Schema.Number),
  maxMessageSizeBytes: Schema.optional(Schema.Number),
  compress: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  decoder: Schema.optional(
    Schema.declare<JetstreamDecoder>((u): u is JetstreamDecoder => typeof u === "function")
  )
}) {}
```

### Jetstream Service (Low-Level)

```typescript
// Jetstream.ts
export const TypeId: unique symbol = Symbol.for("effect-jetstream/Jetstream")
export type TypeId = typeof TypeId

export interface Jetstream {
  readonly [TypeId]: TypeId
  readonly stream: Stream.Stream<JetstreamMessage, JetstreamError>
  readonly send: (message: SubscriberSourcedMessage) => Effect.Effect<void, JetstreamError>
  readonly updateOptions: (options: OptionsUpdate) => Effect.Effect<void, JetstreamError>
}

export const Jetstream: Context.Tag<Jetstream, Jetstream> = internal.tag

export const layer: (config: JetstreamConfig) => Layer.Layer<Jetstream, JetstreamError, Socket.WebSocketConstructor>
export const live: (config: JetstreamConfig) => Layer.Layer<Jetstream, JetstreamError>
```

### JetstreamClient Service (High-Level)

```typescript
// JetstreamClient.ts
export const TypeId: unique symbol = Symbol.for("effect-jetstream/JetstreamClient")
export type TypeId = typeof TypeId

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

export const JetstreamClient: Context.Tag<JetstreamClient, JetstreamClient> = internal.tag
export const layer: Layer.Layer<JetstreamClient, never, Jetstream>
```

## Error Types

Using `Schema.TaggedError` for serializable errors with Equal/Hash:

```typescript
// JetstreamError.ts
export type JetstreamError = ConnectionError | ParseError | SubscriptionError

export class ConnectionError extends Schema.TaggedError<ConnectionError>()(
  "ConnectionError",
  {
    reason: Schema.Literal("Connect", "Timeout", "Closed", "Reconnecting"),
    cause: Schema.optional(Schema.Unknown)
  }
) {}

export class ParseError extends Schema.TaggedError<ParseError>()(
  "ParseError",
  {
    message: Schema.String,
    raw: Schema.optional(Schema.String)
  }
) {}

export class SubscriptionError extends Schema.TaggedError<SubscriptionError>()(
  "SubscriptionError",
  {
    reason: Schema.Literal("InvalidCursor", "TooManyCollections", "TooManyDids")
  }
) {}
```

## Message Schemas

Using `Schema.TaggedClass` for Equal/Hash instances:

```typescript
// JetstreamMessage.ts
export class CommitCreate extends Schema.TaggedClass<CommitCreate>()("CommitCreate", {
  did: Did,
  time_us: Schema.Number,
  kind: Schema.Literal("commit"),
  commit: Schema.Struct({
    rev: Schema.String,
    operation: Schema.Literal("create"),
    collection: Schema.String,
    rkey: Schema.String,
    record: Schema.Unknown, // parsed separately based on collection
    cid: Schema.optional(Schema.String)
  })
}) {}

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

export class IdentityEvent extends Schema.TaggedClass<IdentityEvent>()("IdentityEvent", {
  did: Did,
  time_us: Schema.Number,
  kind: Schema.Literal("identity"),
  identity: Schema.Struct({
    did: Did,
    handle: Schema.String,
    seq: Schema.Number,
    time: Schema.String
  })
}) {}

export class AccountEvent extends Schema.TaggedClass<AccountEvent>()("AccountEvent", {
  did: Did,
  time_us: Schema.Number,
  kind: Schema.Literal("account"),
  account: Schema.Struct({
    active: Schema.Boolean,
    did: Did,
    seq: Schema.Number,
    time: Schema.String,
    status: Schema.optional(Schema.Literal("deactivated", "suspended", "deleted"))
  })
}) {}

export type JetstreamMessage = CommitCreate | CommitUpdate | CommitDelete | IdentityEvent | AccountEvent
export const JetstreamMessage = Schema.Union(CommitCreate, CommitUpdate, CommitDelete, IdentityEvent, AccountEvent)
```

## Bluesky Record Schemas

```typescript
// BlueskyRecord.ts
export const Did = Schema.String.pipe(
  Schema.pattern(/^did:[a-z]+:[a-zA-Z0-9._:%-]+$/),
  Schema.brand("Did")
)
export type Did = typeof Did.Type

export class StrongRef extends Schema.TaggedClass<StrongRef>()("StrongRef", {
  uri: Schema.String,
  cid: Schema.String
}) {}

export class Post extends Schema.TaggedClass<Post>()("Post", {
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

export class Like extends Schema.TaggedClass<Like>()("Like", {
  $type: Schema.Literal("app.bsky.feed.like"),
  subject: StrongRef,
  createdAt: Schema.String
}) {}

export class Follow extends Schema.TaggedClass<Follow>()("Follow", {
  $type: Schema.Literal("app.bsky.graph.follow"),
  subject: Did,
  createdAt: Schema.String
}) {}

export class Repost extends Schema.TaggedClass<Repost>()("Repost", {
  $type: Schema.Literal("app.bsky.feed.repost"),
  subject: StrongRef,
  createdAt: Schema.String
}) {}

export class Block extends Schema.TaggedClass<Block>()("Block", {
  $type: Schema.Literal("app.bsky.graph.block"),
  subject: Did,
  createdAt: Schema.String
}) {}

export class Profile extends Schema.TaggedClass<Profile>()("Profile", {
  $type: Schema.Literal("app.bsky.actor.profile"),
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  avatar: Schema.optional(Schema.Unknown),
  banner: Schema.optional(Schema.Unknown)
}) {}

// Collection to Record type mapping
export type CollectionRecord = {
  "app.bsky.feed.post": Post
  "app.bsky.feed.like": Like
  "app.bsky.feed.repost": Repost
  "app.bsky.graph.follow": Follow
  "app.bsky.graph.block": Block
  "app.bsky.actor.profile": Profile
}
```

## Internal Implementation

### WebSocket Connection

```typescript
// internal/websocket.ts
import * as Socket from "@effect/platform/Socket"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

export const createSocket = (
  url: string
): Effect.Effect<Socket.Socket, ConnectionError, Socket.WebSocketConstructor> =>
  Socket.makeWebSocket(url).pipe(
    Effect.mapError((cause) => new ConnectionError({ reason: "Connect", cause }))
  )

export const messageStream = (
  socket: Socket.Socket
): Stream.Stream<string | Uint8Array, ConnectionError> =>
  Stream.async<string | Uint8Array, ConnectionError>((emit) => {
    const run = socket.runRaw((data) => {
      emit.single(data)
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          emit.fail(new ConnectionError({ reason: "Closed", cause: error }))
        })
      ),
      Effect.ensuring(Effect.sync(() => emit.end()))
    )
    return run
  })
```

### Layer Construction

```typescript
// internal/jetstream.ts
export const TypeId: unique symbol = Symbol.for("effect-jetstream/Jetstream")
export const tag = Context.GenericTag<Jetstream>("effect-jetstream/Jetstream")

const reconnectSchedule = Schedule.exponential("1 second").pipe(
  Schedule.union(Schedule.spaced("30 seconds"))
)

export const layer = (config: JetstreamConfig) =>
  Layer.scoped(
    tag,
    Effect.gen(function* () {
      const url = buildUrl(config)
      const scope = yield* Effect.scope
      const mailbox = yield* Mailbox.make<JetstreamMessage, JetstreamError>()
      const outbound = yield* Queue.bounded<OutboundMessage>(outboundBufferSize)
      const pending = yield* Ref.make<Option.Option<OutboundMessage>>(Option.none())

      const runConnection = Effect.scoped(
        Effect.gen(function* () {
          const socket = yield* Socket.makeWebSocket(url)
          const writer = yield* socket.writer
          yield* Effect.raceFirst(readLoop(socket), writeLoop(writer))
        })
      ).pipe(Effect.retry(reconnectSchedule))

      yield* Effect.forkIn(runConnection, scope)

      return tag.of({
        [TypeId]: TypeId,
        stream: Mailbox.toStream(mailbox),
        send,
        updateOptions
      })
    })
  )
```

## Usage Examples

### Stream-Based (Low-Level)

```typescript
import { Jetstream, JetstreamConfig } from "effect-jetstream"
import { Effect, Stream } from "effect"

const config = JetstreamConfig.JetstreamConfig.make({
  wantedCollections: ["app.bsky.feed.post", "app.bsky.feed.like"]
})

const program = Effect.gen(function* () {
  const jetstream = yield* Jetstream.Jetstream
  
  yield* jetstream.stream.pipe(
    Stream.filter((msg) => msg._tag === "CommitCreate"),
    Stream.tap((msg) => Effect.log(`New ${msg.commit.collection}: ${msg.commit.rkey}`)),
    Stream.runDrain
  )
})

program.pipe(
  Effect.provide(Jetstream.live(config)),
  Effect.runPromise
)
```

### PubSub-Based (High-Level)

```typescript
import { JetstreamClient, Jetstream, JetstreamConfig } from "effect-jetstream"
import { Effect, Layer } from "effect"

const config = JetstreamConfig.JetstreamConfig.make({
  wantedCollections: ["app.bsky.feed.post", "app.bsky.feed.like"]
})

const program = Effect.gen(function* () {
  const client = yield* JetstreamClient.JetstreamClient
  
  yield* client.onCreate("app.bsky.feed.post", (event) =>
    Effect.log(`New post from ${event.did}: ${event.commit.record.text}`)
  )
  
  yield* client.onCreate("app.bsky.feed.like", (event) =>
    Effect.log(`${event.did} liked ${event.commit.record.subject.uri}`)
  )
  
  yield* client.run
})

const MainLayer = JetstreamClient.layer.pipe(
  Layer.provide(Jetstream.live(config))
)

program.pipe(Effect.provide(MainLayer), Effect.runPromise)
```

## Implementation Notes

1. **Use @effect/platform Socket** - Native Effect WebSocket handling for robust connection management
2. **Schema.TaggedClass throughout** - All message and record types use TaggedClass for Equal/Hash
3. **Public/Internal split** - Public modules define types and re-export; implementation in `internal/`
4. **TypeId pattern** - Every service has unique Symbol.for TypeId
5. **Scoped resources** - Layer.scoped ensures WebSocket cleanup on scope finalization
6. **Drop and log** - Malformed messages, invalid records, and handler failures are logged and dropped
7. **Buffered outbound** - Sends queue until the socket is ready and retry after reconnect
8. **Optional zstd** - Decoder is pluggable; Bun.zstdDecompress is the fallback without a dictionary

## Reference Materials

- Effect source: `.reference/effect/` - Study patterns in `packages/effect/src/` and `packages/platform/src/`
- Jetstream docs: `.reference/jetstream-docs/` - Protocol details and API reference
- @skyware/jetstream: https://github.com/skyware-js/jetstream - Reference implementation to match functionality

## Testing Strategy

- Unit tests for schema parsing with sample Jetstream payloads
- Integration tests against public Jetstream instance
- Mock WebSocket for connection lifecycle tests
