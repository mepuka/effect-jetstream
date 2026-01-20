# effect-jetstream

A pure Effect TypeScript client library for [Bluesky Jetstream](https://github.com/bluesky-social/jetstream) - a simplified JSON event stream for the AT Protocol.

## Installation

```bash
bun add effect-jetstream
```

This package depends on `effect` and `@effect/platform`; Bun will install them automatically. If you already use those packages, keep versions aligned.

## Runtime

`Jetstream.live` uses the global `WebSocket` (works in Bun and browsers). If your runtime does not provide one, use `Jetstream.layer` and supply `Socket.WebSocketConstructor` from `@effect/platform/Socket`.

## Usage

### Stream-Based (Low-Level)

```typescript
import { Effect, Stream } from "effect"
import { Jetstream, JetstreamConfig } from "effect-jetstream"

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
import { Effect, Layer } from "effect"
import { Jetstream, JetstreamClient, JetstreamConfig } from "effect-jetstream"

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

## Configuration

```typescript
JetstreamConfig.JetstreamConfig.make({
  // WebSocket endpoint (default: wss://jetstream1.us-east.bsky.network/subscribe)
  endpoint: "wss://jetstream2.us-east.bsky.network/subscribe",
  
  // Collections to subscribe to (supports wildcards like "app.bsky.feed.*")
  wantedCollections: ["app.bsky.feed.post"],
  
  // DIDs to filter by
  wantedDids: ["did:plc:..."],
  
  // Unix microseconds cursor for replay
  cursor: 1725911162329308,
  
  // Max message size (0 = no limit)
  maxMessageSizeBytes: 1000000,
  
  // Enable zstd compression (Jetstream uses a custom dictionary)
  compress: false,
  
  // Optional decoder for compressed payloads
  // If omitted, Bun.zstdDecompress is used without a dictionary and a warning is logged.
  // decoder: (data) => Effect.tryPromise(() => Bun.zstdDecompress(data))
})
```

When `compress` is true, provide a decoder that understands Jetstream's dictionary. If you omit it, the client falls back to `Bun.zstdDecompress` without a dictionary and logs a warning.

## Behavior

- Malformed messages are logged and dropped; the stream continues.
- Record decode failures in `JetstreamClient` are logged and dropped.
- Handler failures are logged and do not stop processing.
- Outbound messages are buffered; `send` waits for a ready socket and resends after reconnect.

## Event Types

- `CommitCreate` - New record created
- `CommitUpdate` - Record updated
- `CommitDelete` - Record deleted
- `IdentityEvent` - Handle or DID document changes
- `AccountEvent` - Account status changes

## Bluesky Record Types

- `Post` - app.bsky.feed.post
- `Like` - app.bsky.feed.like
- `Repost` - app.bsky.feed.repost
- `Follow` - app.bsky.graph.follow
- `Block` - app.bsky.graph.block
- `Profile` - app.bsky.actor.profile

## API

### Jetstream Service (Low-Level)

```typescript
interface Jetstream {
  // Stream of parsed messages
  readonly stream: Stream<JetstreamMessage, JetstreamError>
  
  // Send a message to the server
  readonly send: (message: SubscriberSourcedMessage) => Effect<void, JetstreamError>
  
  // Update subscription options
  readonly updateOptions: (options: OptionsUpdate) => Effect<void, JetstreamError>
}
```

### JetstreamClient Service (High-Level)

```typescript
interface JetstreamClient {
  // Register handler for new records in a collection
  readonly onCreate: <C extends Collection>(
    collection: C,
    handler: (event: CommitCreate & { readonly commit: { readonly record: RecordFor<C> } }) => Effect<void>
  ) => Effect<void>
  
  // Register handler for updated records
  readonly onUpdate: <C extends Collection>(
    collection: C,
    handler: (event: CommitUpdate & { readonly commit: { readonly record: RecordFor<C> } }) => Effect<void>
  ) => Effect<void>
  
  // Register handler for deleted records
  readonly onDelete: <C extends Collection>(
    collection: C,
    handler: (event: CommitDelete) => Effect<void>
  ) => Effect<void>
  
  // Register handler for event kinds (commit, identity, account)
  readonly on: <K extends EventKind>(
    kind: K,
    handler: (event: EventFor<K>) => Effect<void>
  ) => Effect<void>
  
  // Run the client (blocks forever)
  readonly run: Effect<never, JetstreamError>
}
```

## License

MIT
