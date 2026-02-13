import { describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { parseHarnessOptions } from "./options.js"

describe("harness options", () => {
  test("parses defaults", async () => {
    const options = await Effect.runPromise(parseHarnessOptions([]))

    expect(options.mode).toBe("live")
    expect(options.durationSec).toBe(60)
    expect(options.reportEverySec).toBe(5)
    expect(options.jsonOut).toBe("tmp/harness-report.json")
    expect(options.collections).toEqual([])
    expect(options.dids).toEqual([])
    expect(options.replayFile).toBe("examples/fixtures/jetstream-sample.ndjson")
    expect(options.replayRatePerSec).toBe(0)
  })

  test("parses explicit values and gates", async () => {
    const options = await Effect.runPromise(parseHarnessOptions([
      "--mode", "replay",
      "--durationSec", "30",
      "--reportEverySec", "2",
      "--jsonOut", "tmp/out.json",
      "--collections", "app.bsky.feed.post,app.bsky.feed.like",
      "--dids", "did:plc:one,did:plc:two",
      "--endpoint", "wss://jetstream2.us-east.bsky.network/subscribe",
      "--replayFile", "examples/fixtures/jetstream-sample.ndjson",
      "--replayRatePerSec", "100",
      "--gateMinEventsPerSec", "10",
      "--gateMaxDecodeErrors", "2",
      "--gateMaxInboundDrops", "3",
      "--gateMaxReconnects", "4",
      "--gateMaxP95LagMs", "500"
    ]))

    expect(options.mode).toBe("replay")
    expect(options.durationSec).toBe(30)
    expect(options.reportEverySec).toBe(2)
    expect(options.jsonOut).toBe("tmp/out.json")
    expect(options.collections).toEqual(["app.bsky.feed.post", "app.bsky.feed.like"])
    expect(options.dids).toEqual(["did:plc:one", "did:plc:two"])
    expect(options.replayRatePerSec).toBe(100)
    expect(options.gateMinEventsPerSec).toBe(10)
    expect(options.gateMaxDecodeErrors).toBe(2)
    expect(options.gateMaxInboundDrops).toBe(3)
    expect(options.gateMaxReconnects).toBe(4)
    expect(options.gateMaxP95LagMs).toBe(500)
  })

  test("fails on invalid mode", async () => {
    const exit = await Effect.runPromiseExit(parseHarnessOptions(["--mode", "invalid"]))

    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("fails on invalid duration", async () => {
    const exit = await Effect.runPromiseExit(parseHarnessOptions(["--durationSec", "-1"]))

    expect(Exit.isFailure(exit)).toBe(true)
  })
})
