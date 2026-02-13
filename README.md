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
  // If omitted in Bun, Bun.zstdDecompress is used without a dictionary and a warning is logged.
  // In non-Bun runtimes, a decoder is required when compress=true.
  // decoder: (data) => Effect.tryPromise(() => Bun.zstdDecompress(data))

  // Inbound message buffering
  inboundBufferSize: 4096,
  inboundBufferStrategy: "suspend", // "suspend" | "dropping" | "sliding"

  // Optional runtime observer for instrumentation
  runtimeObserver: (event) => Effect.logDebug("jetstream-runtime", event)
})
```

When `compress` is true, provide a decoder that understands Jetstream's dictionary. If you omit it, the client falls back to `Bun.zstdDecompress` only in Bun and logs a warning. In runtimes without Bun, layer construction fails with a typed `ParseError`.

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

  // Gracefully close the connection and end the stream
  readonly shutdown: Effect<void>
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
  
  // Run the client until the stream ends (e.g. on shutdown)
  readonly run: Effect<void, JetstreamError>

  // Run the client forever
  readonly runForever: Effect<never, JetstreamError>
}
```

## Local Harness

The repository includes a local Bun harness for smoke/performance testing with Effect metrics.

### Commands

```bash
bun run harness
bun run harness:live
bun run harness:replay
```

### Modes

- `live`: connects to Jetstream and tracks throughput/runtime signals.
- `replay`: replays NDJSON fixture messages (default fixture: `examples/fixtures/jetstream-sample.ndjson`).

### Useful Flags

```bash
bun run harness --mode replay --durationSec 30 --reportEverySec 5 --replayRatePerSec 200
bun run harness --mode live --collections app.bsky.feed.post --jsonOut tmp/live-report.json
```

Optional gate flags fail the run (`exit 1`) when violated:

- `--gateMinEventsPerSec`
- `--gateMaxDecodeErrors`
- `--gateMaxInboundDrops`
- `--gateMaxReconnects`
- `--gateMaxP95LagMs`

The harness prints periodic summaries and writes a final JSON report (`tmp/harness-report.json` by default).

## License

MIT
