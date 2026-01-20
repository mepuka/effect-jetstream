/**
 * Low-level stream-based example for consuming Jetstream events.
 */
import { Effect, Stream } from "effect"
import { Jetstream, JetstreamConfig } from "../src/index.js"

const config = JetstreamConfig.JetstreamConfig.make({
  wantedCollections: ["app.bsky.feed.post", "app.bsky.feed.like"]
})

const program = Effect.gen(function* () {
  const jetstream = yield* Jetstream.Jetstream
  
  yield* jetstream.stream.pipe(
    Stream.filter((msg) => msg._tag === "CommitCreate"),
    Stream.take(10),
    Stream.tap((msg) => Effect.log(`New ${msg.commit.collection}: ${msg.commit.rkey}`)),
    Stream.runDrain
  )
})

program.pipe(
  Effect.provide(Jetstream.live(config)),
  Effect.runPromise
).then(() => console.log("Done!"))
  .catch(console.error)
