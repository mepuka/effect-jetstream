import * as Effect from "effect/Effect"
import * as Metric from "effect/Metric"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import type { JetstreamRuntimeEvent } from "../../src/JetstreamConfig.js"
import type { JetstreamMessage } from "../../src/JetstreamMessage.js"

export interface HarnessMetrics {
  readonly runId: string
  readonly startedAtMs: number
  readonly eventsTotal: Metric.Metric.Counter<number>
  readonly eventKind: Metric.Metric.Frequency<string>
  readonly decodeErrorsTotal: Metric.Metric.Counter<number>
  readonly inboundDropsTotal: Metric.Metric.Counter<number>
  readonly reconnectsTotal: Metric.Metric.Counter<number>
  readonly outboundEncodeFailuresTotal: Metric.Metric.Counter<number>
  readonly outboundSendFailuresTotal: Metric.Metric.Counter<number>
  readonly eventsPerSecWindow: Metric.Metric.Gauge<number>
  readonly messageLagMs: Metric.Metric.Summary<number>
  readonly runtimeSeconds: Metric.Metric.Gauge<number>
  readonly windowCursor: Ref.Ref<{
    readonly previousEvents: number
    readonly previousTimestampMs: number
  }>
}

export interface HarnessReport {
  readonly runId: string
  readonly mode: "live" | "replay"
  readonly startedAt: string
  readonly endedAt: string
  readonly runtimeSeconds: number
  readonly totals: {
    readonly events: number
    readonly decodeErrors: number
    readonly inboundDrops: number
    readonly reconnects: number
    readonly outboundEncodeFailures: number
    readonly outboundSendFailures: number
  }
  readonly rates: {
    readonly avgEventsPerSec: number
    readonly windowEventsPerSec: number
  }
  readonly lagMs: {
    readonly p50: number | null
    readonly p95: number | null
    readonly p99: number | null
  }
  readonly eventKinds: Readonly<Record<string, number>>
}

const withRunId = <Type, In, Out>(
  metric: Metric.Metric<Type, In, Out>,
  runId: string
): Metric.Metric<Type, In, Out> => metric.pipe(Metric.tagged("run_id", runId))

const readCounter = (counter: Metric.Metric.Counter<number>): Effect.Effect<number> =>
  Metric.value(counter).pipe(
    Effect.map((state) => state.count)
  )

const readGauge = (gauge: Metric.Metric.Gauge<number>): Effect.Effect<number> =>
  Metric.value(gauge).pipe(
    Effect.map((state) => state.value)
  )

const readQuantile = (
  state: { readonly quantiles: ReadonlyArray<readonly [number, Option.Option<number>]> },
  quantile: number
): number | null => {
  const found = state.quantiles.find(([value]) => Math.abs(value - quantile) < Number.EPSILON)
  if (!found) {
    return null
  }
  return Option.getOrUndefined(found[1]) ?? null
}

export const createHarnessMetrics = Effect.fn("Harness.createMetrics")(
  ({ runId, startedAtMs }: { readonly runId: string; readonly startedAtMs: number }): Effect.Effect<HarnessMetrics> =>
    Effect.gen(function* () {
      const eventsTotal = withRunId(
        Metric.counter("harness_events_total", { incremental: true }),
        runId
      ).register()
      const eventKind = withRunId(
        Metric.frequency("harness_event_kind"),
        runId
      ).register()
      const decodeErrorsTotal = withRunId(
        Metric.counter("harness_decode_errors_total", { incremental: true }),
        runId
      ).register()
      const inboundDropsTotal = withRunId(
        Metric.counter("harness_inbound_drops_total", { incremental: true }),
        runId
      ).register()
      const reconnectsTotal = withRunId(
        Metric.counter("harness_reconnects_total", { incremental: true }),
        runId
      ).register()
      const outboundEncodeFailuresTotal = withRunId(
        Metric.counter("harness_outbound_encode_failures_total", { incremental: true }),
        runId
      ).register()
      const outboundSendFailuresTotal = withRunId(
        Metric.counter("harness_outbound_send_failures_total", { incremental: true }),
        runId
      ).register()
      const eventsPerSecWindow = withRunId(
        Metric.gauge("harness_events_per_sec_window"),
        runId
      ).register()
      const messageLagMs = withRunId(
        Metric.summary({
          name: "harness_message_lag_ms",
          maxAge: "1 hour",
          maxSize: 100000,
          error: 0.01,
          quantiles: [0.5, 0.95, 0.99]
        }),
        runId
      ).register()
      const runtimeSeconds = withRunId(
        Metric.gauge("harness_runtime_seconds"),
        runId
      ).register()
      const windowCursor = yield* Ref.make({
        previousEvents: 0,
        previousTimestampMs: startedAtMs
      })

      return {
        runId,
        startedAtMs,
        eventsTotal,
        eventKind,
        decodeErrorsTotal,
        inboundDropsTotal,
        reconnectsTotal,
        outboundEncodeFailuresTotal,
        outboundSendFailuresTotal,
        eventsPerSecWindow,
        messageLagMs,
        runtimeSeconds,
        windowCursor
      }
    })
)

export const recordDeliveredMessage = Effect.fn("Harness.recordDeliveredMessage")(
  (metrics: HarnessMetrics, message: JetstreamMessage): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* Metric.increment(metrics.eventsTotal)
      yield* Metric.update(metrics.eventKind, message.kind)

      const lagMs = Math.max(0, Date.now() - Math.floor(message.time_us / 1000))
      yield* Metric.update(metrics.messageLagMs, lagMs)
    })
)

export const recordRuntimeEvent = Effect.fn("Harness.recordRuntimeEvent")(
  (metrics: HarnessMetrics, event: JetstreamRuntimeEvent): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* Metric.update(metrics.eventKind, `runtime:${event._tag}`)
      switch (event._tag) {
        case "ConnectionClosed":
          yield* Metric.increment(metrics.reconnectsTotal)
          break
        case "DecodeFailed":
          yield* Metric.increment(metrics.decodeErrorsTotal)
          break
        case "InboundDropped":
          yield* Metric.increment(metrics.inboundDropsTotal)
          break
        case "OutboundEncodeFailed":
          yield* Metric.increment(metrics.outboundEncodeFailuresTotal)
          break
        default:
          return
      }
    })
)

export const recordOutboundSendFailure = Effect.fn("Harness.recordOutboundSendFailure")(
  (metrics: HarnessMetrics): Effect.Effect<void> => Metric.increment(metrics.outboundSendFailuresTotal)
)

export const refreshWindowMetrics = Effect.fn("Harness.refreshWindowMetrics")(
  (metrics: HarnessMetrics, nowMs: number): Effect.Effect<void> =>
    Effect.gen(function* () {
      const totalEvents = yield* readCounter(metrics.eventsTotal)
      const cursor = yield* Ref.get(metrics.windowCursor)
      const deltaEvents = Math.max(0, totalEvents - cursor.previousEvents)
      const deltaMs = Math.max(1, nowMs - cursor.previousTimestampMs)
      const windowRate = (deltaEvents * 1000) / deltaMs
      const runtime = Math.max(0, (nowMs - metrics.startedAtMs) / 1000)

      yield* Metric.set(metrics.eventsPerSecWindow, windowRate)
      yield* Metric.set(metrics.runtimeSeconds, runtime)
      yield* Ref.set(metrics.windowCursor, {
        previousEvents: totalEvents,
        previousTimestampMs: nowMs
      })
    })
)

export const collectHarnessReport = Effect.fn("Harness.collectReport")(
  (
    metrics: HarnessMetrics,
    mode: "live" | "replay",
    nowMs: number
  ): Effect.Effect<HarnessReport> =>
    Effect.gen(function* () {
      yield* refreshWindowMetrics(metrics, nowMs)

      const [
        events,
        decodeErrors,
        inboundDrops,
        reconnects,
        outboundEncodeFailures,
        outboundSendFailures,
        windowEventsPerSec,
        runtime,
        lagState,
        eventKindsState
      ] = yield* Effect.all([
        readCounter(metrics.eventsTotal),
        readCounter(metrics.decodeErrorsTotal),
        readCounter(metrics.inboundDropsTotal),
        readCounter(metrics.reconnectsTotal),
        readCounter(metrics.outboundEncodeFailuresTotal),
        readCounter(metrics.outboundSendFailuresTotal),
        readGauge(metrics.eventsPerSecWindow),
        readGauge(metrics.runtimeSeconds),
        Metric.value(metrics.messageLagMs),
        Metric.value(metrics.eventKind)
      ])

      const avgEventsPerSec = runtime > 0 ? events / runtime : 0
      const eventKinds = Object.fromEntries(eventKindsState.occurrences.entries())

      return {
        runId: metrics.runId,
        mode,
        startedAt: new Date(metrics.startedAtMs).toISOString(),
        endedAt: new Date(nowMs).toISOString(),
        runtimeSeconds: runtime,
        totals: {
          events,
          decodeErrors,
          inboundDrops,
          reconnects,
          outboundEncodeFailures,
          outboundSendFailures
        },
        rates: {
          avgEventsPerSec,
          windowEventsPerSec
        },
        lagMs: {
          p50: readQuantile(lagState, 0.5),
          p95: readQuantile(lagState, 0.95),
          p99: readQuantile(lagState, 0.99)
        },
        eventKinds
      }
    })
)

const formatRate = (value: number): string => value.toFixed(2)
const formatMaybeNumber = (value: number | null): string => (value === null ? "n/a" : value.toFixed(2))

export const formatConsoleSummary = (report: HarnessReport): string =>
  [
    `[harness:${report.mode}]`,
    `runtime=${report.runtimeSeconds.toFixed(1)}s`,
    `events=${report.totals.events}`,
    `eps(avg=${formatRate(report.rates.avgEventsPerSec)},window=${formatRate(report.rates.windowEventsPerSec)})`,
    `decodeErrors=${report.totals.decodeErrors}`,
    `drops=${report.totals.inboundDrops}`,
    `reconnects=${report.totals.reconnects}`,
    `lag(p95=${formatMaybeNumber(report.lagMs.p95)}ms)`
  ].join(" ")

export const runPeriodicReporter = Effect.fn("Harness.runPeriodicReporter")(
  (
    metrics: HarnessMetrics,
    mode: "live" | "replay",
    reportEverySec: number
  ): Effect.Effect<never> =>
    Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep(`${reportEverySec} seconds`)
        const report = yield* collectHarnessReport(metrics, mode, Date.now())
        yield* Effect.sync(() => {
          console.log(formatConsoleSummary(report))
        })
      }
    })
)
