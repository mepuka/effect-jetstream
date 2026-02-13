import { describe, expect, test } from "bun:test"
import { evaluateGates } from "./gates.js"
import type { HarnessReport } from "./metrics.js"
import { HarnessOptions } from "./options.js"

const baseReport: HarnessReport = {
  runId: "test",
  mode: "replay",
  startedAt: "2026-01-01T00:00:00.000Z",
  endedAt: "2026-01-01T00:01:00.000Z",
  runtimeSeconds: 60,
  totals: {
    events: 600,
    decodeErrors: 1,
    inboundDrops: 2,
    reconnects: 3,
    outboundEncodeFailures: 0,
    outboundSendFailures: 0
  },
  rates: {
    avgEventsPerSec: 10,
    windowEventsPerSec: 12
  },
  lagMs: {
    p50: 30,
    p95: 150,
    p99: 300
  },
  eventKinds: {
    commit: 500,
    identity: 50,
    account: 50
  }
}

describe("harness gates", () => {
  test("passes when no gates configured", () => {
    const options = HarnessOptions.make({})
    const result = evaluateGates(baseReport, options)

    expect(result.configured).toBe(false)
    expect(result.passed).toBe(true)
    expect(result.violations).toEqual([])
  })

  test("fails when metrics exceed thresholds", () => {
    const options = HarnessOptions.make({
      gateMinEventsPerSec: 11,
      gateMaxDecodeErrors: 0,
      gateMaxInboundDrops: 1,
      gateMaxReconnects: 2,
      gateMaxP95LagMs: 120
    })
    const result = evaluateGates(baseReport, options)

    expect(result.configured).toBe(true)
    expect(result.passed).toBe(false)
    expect(result.violations.length).toBe(5)
  })

  test("passes when metrics are within thresholds", () => {
    const options = HarnessOptions.make({
      gateMinEventsPerSec: 9,
      gateMaxDecodeErrors: 2,
      gateMaxInboundDrops: 3,
      gateMaxReconnects: 4,
      gateMaxP95LagMs: 200
    })
    const result = evaluateGates(baseReport, options)

    expect(result.configured).toBe(true)
    expect(result.passed).toBe(true)
    expect(result.violations).toEqual([])
  })
})
