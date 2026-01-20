/**
 * High-level PubSub-based example for consuming Jetstream events.
 */
import { Effect, Layer } from "effect"
import { Jetstream, JetstreamClient, JetstreamConfig } from "../src/index.js"

const config = JetstreamConfig.JetstreamConfig.make({
  wantedCollections: ["app.bsky.feed.post", "app.bsky.feed.like"]
})

const program = Effect.gen(function* () {
  const client = yield* JetstreamClient.JetstreamClient
  
  yield* client.onCreate("app.bsky.feed.post", (event) =>
    Effect.log(`New post from ${event.did}: ${event.commit.record.text?.slice(0, 50)}`)
  )
  
  yield* client.onCreate("app.bsky.feed.like", (event) =>
    Effect.log(`${event.did} liked ${event.commit.record.subject?.uri}`)
  )
  
  yield* client.run
})

const MainLayer = JetstreamClient.layer.pipe(
  Layer.provide(Jetstream.live(config))
)

program.pipe(
  Effect.provide(MainLayer),
  Effect.runPromise
).catch(console.error)
