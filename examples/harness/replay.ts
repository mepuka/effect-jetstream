import * as Effect from "effect/Effect"
import { decodeMessage } from "../../src/internal/decoder.js"
import type { HarnessMetrics } from "./metrics.js"
import { recordDeliveredMessage, recordRuntimeEvent } from "./metrics.js"
import type { HarnessOptions } from "./options.js"

const loadReplayLines = Effect.fn("Harness.loadReplayLines")(
  (path: string): Effect.Effect<ReadonlyArray<string>, Error> =>
    Effect.tryPromise({
      try: async () => {
        const text = await Bun.file(path).text()
        return text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
      },
      catch: (cause) => new Error(`Failed to load replay file '${path}': ${String(cause)}`)
    })
)

export const runReplayHarness = Effect.fn("Harness.runReplay")(
  (options: HarnessOptions, metrics: HarnessMetrics): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const lines = yield* loadReplayLines(options.replayFile)
      if (lines.length === 0) {
        return yield* Effect.fail(new Error(`Replay file '${options.replayFile}' does not contain any messages`))
      }

      const deadline = Date.now() + (options.durationSec * 1000)
      const delayMs = options.replayRatePerSec > 0
        ? 1000 / options.replayRatePerSec
        : 0

      let index = 0
      while (Date.now() < deadline) {
        const line = lines[index % lines.length]
        if (!line) {
          break
        }

        yield* decodeMessage(line).pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              recordRuntimeEvent(metrics, {
                _tag: "DecodeFailed",
                timestampMs: Date.now(),
                message: error.message
              }),
            onSuccess: (message) => recordDeliveredMessage(metrics, message)
          })
        )

        index++

        if (delayMs > 0) {
          yield* Effect.sleep(delayMs)
        } else if (index % 1000 === 0) {
          yield* Effect.yieldNow()
        }
      }
    })
)
