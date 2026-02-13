import { describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { collectHarnessReport, createHarnessMetrics } from "./metrics.js"
import { HarnessOptions } from "./options.js"
import { runReplayHarness } from "./replay.js"

describe("harness replay", () => {
  test("replay mode processes fixture messages and produces throughput", async () => {
    const startedAtMs = Date.now()
    const report = await Effect.runPromise(
      Effect.gen(function* () {
        const metrics = yield* createHarnessMetrics({
          runId: "replay-test",
          startedAtMs
        })

        const options = HarnessOptions.make({
          mode: "replay",
          durationSec: 1,
          replayFile: "examples/fixtures/jetstream-sample.ndjson",
          replayRatePerSec: 200
        })

        yield* runReplayHarness(options, metrics)
        return yield* collectHarnessReport(metrics, "replay", Date.now())
      })
    )

    expect(report.totals.events).toBeGreaterThan(0)
    expect(report.rates.avgEventsPerSec).toBeGreaterThan(0)
    expect(report.totals.decodeErrors).toBe(0)
  })

  test("replay mode counts decode failures from malformed lines", async () => {
    const fixturePath = "/tmp/effect-jetstream-harness-malformed.ndjson"
    const startedAtMs = Date.now()

    const report = await Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () =>
            Bun.write(
              fixturePath,
              [
                "{\"did\":\"did:plc:abc123\",\"time_us\":1725911162329308,\"kind\":\"commit\",\"commit\":{\"rev\":\"1\",\"operation\":\"delete\",\"collection\":\"app.bsky.feed.post\",\"rkey\":\"r1\"}}",
                "not json"
              ].join("\n")
            ),
          catch: (cause) => new Error(`Unable to create malformed fixture: ${String(cause)}`)
        })

        const metrics = yield* createHarnessMetrics({
          runId: "replay-malformed-test",
          startedAtMs
        })

        const options = HarnessOptions.make({
          mode: "replay",
          durationSec: 1,
          replayFile: fixturePath,
          replayRatePerSec: 100
        })

        yield* runReplayHarness(options, metrics)
        return yield* collectHarnessReport(metrics, "replay", Date.now())
      })
    )

    expect(report.totals.events).toBeGreaterThan(0)
    expect(report.totals.decodeErrors).toBeGreaterThan(0)
  })
})
