import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import { evaluateGates } from "./harness/gates.js"
import {
  collectHarnessReport,
  createHarnessMetrics,
  formatConsoleSummary,
  runPeriodicReporter,
  type HarnessReport
} from "./harness/metrics.js"
import { runLiveHarness } from "./harness/live.js"
import { parseHarnessOptions } from "./harness/options.js"
import { runReplayHarness } from "./harness/replay.js"

const writeJsonReport = Effect.fn("Harness.writeJsonReport")(
  (path: string, report: unknown): Effect.Effect<void, Error> =>
    Effect.tryPromise({
      try: async () => {
        await mkdir(dirname(path), { recursive: true })
        await Bun.write(path, `${JSON.stringify(report, null, 2)}\n`)
      },
      catch: (cause) => new Error(`Failed to write report '${path}': ${String(cause)}`)
    })
)

const program = Effect.scoped(
  Effect.gen(function* () {
    const options = yield* parseHarnessOptions(process.argv.slice(2))
    const startedAtMs = Date.now()
    const runId = `${startedAtMs}-${Math.random().toString(16).slice(2, 10)}`

    const metrics = yield* createHarnessMetrics({
      runId,
      startedAtMs
    })

    yield* Effect.sync(() => {
      console.log(`[harness] mode=${options.mode} duration=${options.durationSec}s reportEvery=${options.reportEverySec}s runId=${runId}`)
    })

    const reporterFiber = yield* Effect.forkScoped(
      runPeriodicReporter(metrics, options.mode, options.reportEverySec)
    )
    void reporterFiber

    if (options.mode === "live") {
      yield* runLiveHarness(options, metrics)
    } else {
      yield* runReplayHarness(options, metrics)
    }

    const report = yield* collectHarnessReport(metrics, options.mode, Date.now())
    const gates = evaluateGates(report, options)

    const reportWithGates: HarnessReport & {
      readonly gates: typeof gates
      readonly options: HarnessOptionsSummary
    } = {
      ...report,
      gates,
      options: {
        mode: options.mode,
        durationSec: options.durationSec,
        reportEverySec: options.reportEverySec,
        jsonOut: options.jsonOut,
        endpoint: options.endpoint,
        replayFile: options.replayFile,
        replayRatePerSec: options.replayRatePerSec,
        collections: options.collections,
        dids: options.dids,
        gateMinEventsPerSec: options.gateMinEventsPerSec,
        gateMaxDecodeErrors: options.gateMaxDecodeErrors,
        gateMaxInboundDrops: options.gateMaxInboundDrops,
        gateMaxReconnects: options.gateMaxReconnects,
        gateMaxP95LagMs: options.gateMaxP95LagMs
      }
    }

    yield* writeJsonReport(options.jsonOut, reportWithGates)

    yield* Effect.sync(() => {
      console.log(formatConsoleSummary(report))
      console.log(`[harness] report written: ${options.jsonOut}`)
    })

    if (gates.configured && !gates.passed) {
      yield* Effect.sync(() => {
        console.error("[harness] gate violations:")
        for (const violation of gates.violations) {
          console.error(`- ${violation}`)
        }
      })
      return yield* Effect.fail(new Error(`Harness gates failed (${gates.violations.length} violation(s))`))
    }
  })
)

type HarnessOptionsSummary = {
  readonly mode: "live" | "replay"
  readonly durationSec: number
  readonly reportEverySec: number
  readonly jsonOut: string
  readonly endpoint: string
  readonly replayFile: string
  readonly replayRatePerSec: number
  readonly collections: ReadonlyArray<string>
  readonly dids: ReadonlyArray<string>
  readonly gateMinEventsPerSec?: number
  readonly gateMaxDecodeErrors?: number
  readonly gateMaxInboundDrops?: number
  readonly gateMaxReconnects?: number
  readonly gateMaxP95LagMs?: number
}

void Effect.runPromiseExit(program).then((exit) => {
  if (Exit.isFailure(exit)) {
    const failure = Option.getOrUndefined(Cause.failureOption(exit.cause))
    if (failure instanceof Error) {
      console.error(`[harness] ${failure.message}`)
    } else {
      console.error(Cause.pretty(exit.cause))
    }
    process.exitCode = 1
  }
})
