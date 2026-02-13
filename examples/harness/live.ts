import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import { Jetstream, JetstreamConfig } from "../../src/index.js"
import type { HarnessMetrics } from "./metrics.js"
import { recordDeliveredMessage, recordRuntimeEvent } from "./metrics.js"
import type { HarnessOptions } from "./options.js"

export const runLiveHarness = Effect.fn("Harness.runLive")(
  (options: HarnessOptions, metrics: HarnessMetrics): Effect.Effect<void> => {
    const config = JetstreamConfig.JetstreamConfig.make({
      endpoint: options.endpoint,
      wantedCollections: options.collections,
      wantedDids: options.dids,
      runtimeObserver: (event) => recordRuntimeEvent(metrics, event)
    })

    const program = Effect.gen(function* () {
      const jetstream = yield* Jetstream.Jetstream
      const streamFiber = yield* jetstream.stream.pipe(
        Stream.tap((message) => recordDeliveredMessage(metrics, message)),
        Stream.runDrain,
        Effect.fork
      )

      yield* Effect.sleep(`${options.durationSec} seconds`)
      yield* jetstream.shutdown
      yield* Fiber.join(streamFiber)
    })

    return program.pipe(Effect.provide(Jetstream.live(config)))
  }
)
