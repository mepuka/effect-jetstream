import type { HarnessReport } from "./metrics.js"
import type { HarnessOptions } from "./options.js"

export interface HarnessGateResult {
  readonly configured: boolean
  readonly passed: boolean
  readonly violations: ReadonlyArray<string>
}

const isDefined = <A>(value: A | undefined): value is A => value !== undefined

export const evaluateGates = (
  report: HarnessReport,
  options: HarnessOptions
): HarnessGateResult => {
  const violations: Array<string> = []

  if (isDefined(options.gateMinEventsPerSec) && report.rates.avgEventsPerSec < options.gateMinEventsPerSec) {
    violations.push(
      `avg events/sec ${report.rates.avgEventsPerSec.toFixed(2)} is below minimum ${options.gateMinEventsPerSec.toFixed(2)}`
    )
  }

  if (isDefined(options.gateMaxDecodeErrors) && report.totals.decodeErrors > options.gateMaxDecodeErrors) {
    violations.push(
      `decode errors ${report.totals.decodeErrors} exceeds maximum ${options.gateMaxDecodeErrors}`
    )
  }

  if (isDefined(options.gateMaxInboundDrops) && report.totals.inboundDrops > options.gateMaxInboundDrops) {
    violations.push(
      `inbound drops ${report.totals.inboundDrops} exceeds maximum ${options.gateMaxInboundDrops}`
    )
  }

  if (isDefined(options.gateMaxReconnects) && report.totals.reconnects > options.gateMaxReconnects) {
    violations.push(
      `reconnects ${report.totals.reconnects} exceeds maximum ${options.gateMaxReconnects}`
    )
  }

  if (isDefined(options.gateMaxP95LagMs)) {
    const p95 = report.lagMs.p95
    if (p95 === null) {
      violations.push("p95 lag is unavailable")
    } else if (p95 > options.gateMaxP95LagMs) {
      violations.push(
        `p95 lag ${p95.toFixed(2)}ms exceeds maximum ${options.gateMaxP95LagMs.toFixed(2)}ms`
      )
    }
  }

  const configured =
    isDefined(options.gateMinEventsPerSec) ||
    isDefined(options.gateMaxDecodeErrors) ||
    isDefined(options.gateMaxInboundDrops) ||
    isDefined(options.gateMaxReconnects) ||
    isDefined(options.gateMaxP95LagMs)

  return {
    configured,
    passed: violations.length === 0,
    violations
  }
}
