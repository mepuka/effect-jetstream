import { mkdir } from "node:fs/promises"
import { cpus } from "node:os"
import { join } from "node:path"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { JetstreamConfig, type JetstreamRuntimeEvent } from "../src/JetstreamConfig.js"
import { decodeMessage } from "../src/internal/decoder.js"
import { tag as JetstreamTag, layer as jetstreamLayer } from "../src/internal/jetstream.js"
import { FakeWebSocketFactory, layer as fakeWebSocketLayer } from "../src/internal/test/FakeWebSocket.js"

type CliArgs = Record<string, string | true>

type MatrixOptions = {
  readonly durationSec: number
  readonly reportEverySec: number
  readonly trials: number
  readonly warmupTrials: number
  readonly outDir: string
  readonly replayFile: string
  readonly replayRates: ReadonlyArray<number>
  readonly includeDecode: boolean
  readonly includePipeline: boolean
}

type Scenario =
  | {
      readonly kind: "decode"
      readonly name: string
      readonly description: string
    }
  | {
      readonly kind: "harness"
      readonly name: string
      readonly description: string
      readonly args: ReadonlyArray<string>
    }
  | {
      readonly kind: "pipeline"
      readonly name: string
      readonly description: string
      readonly replayRatePerSec: number
    }

type TrialReport = {
  readonly mode: "decode" | "replay" | "pipeline"
  readonly runtimeSeconds: number
  readonly totals: {
    readonly events: number
    readonly decodeErrors: number
    readonly inboundDrops: number
    readonly mailboxDrops: number
    readonly ingressDrops: number
    readonly reconnects: number
    readonly outboundEncodeFailures: number
    readonly outboundSendFailures: number
  }
  readonly rates: {
    readonly avgEventsPerSec: number
    readonly windowEventsPerSec: number
  }
  readonly lagMs: {
    readonly p95: number | null
    readonly p99: number | null
  }
}

type TrialResult = {
  readonly scenario: string
  readonly trial: number
  readonly warmup: boolean
  readonly elapsedMs: number
  readonly reportPath: string
  readonly report?: TrialReport
  readonly error?: string
}

type Stats = {
  readonly min: number
  readonly max: number
  readonly mean: number
  readonly median: number
  readonly p95: number
}

type ScenarioSummary = {
  readonly name: string
  readonly description: string
  readonly measuredTrials: number
  readonly failedTrials: number
  readonly rates: {
    readonly avgEventsPerSec: Stats | null
    readonly windowEventsPerSec: Stats | null
  }
  readonly lagMs: {
    readonly p95: Stats | null
    readonly p99: Stats | null
  }
  readonly totals: {
    readonly decodeErrors: Stats | null
    readonly inboundDrops: Stats | null
    readonly mailboxDrops: Stats | null
    readonly ingressDrops: Stats | null
    readonly reconnects: Stats | null
  }
}

const decoder = new TextDecoder()

const parseCliArgs = (argv: ReadonlyArray<string>): CliArgs => {
  const parsed: CliArgs = {}
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!token || !token.startsWith("--")) {
      continue
    }
    const segment = token.slice(2)
    const equalIndex = segment.indexOf("=")
    if (equalIndex >= 0) {
      parsed[segment.slice(0, equalIndex)] = segment.slice(equalIndex + 1)
      continue
    }
    const next = argv[index + 1]
    if (next && !next.startsWith("--")) {
      parsed[segment] = next
      index++
      continue
    }
    parsed[segment] = true
  }
  return parsed
}

const asNumber = (value: string | true | undefined, fallback: number): number => {
  if (value === undefined) {
    return fallback
  }
  if (value === true) {
    return Number.NaN
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

const asBoolean = (value: string | true | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback
  }
  if (value === true) {
    return true
  }
  if (value.toLowerCase() === "true") {
    return true
  }
  if (value.toLowerCase() === "false") {
    return false
  }
  return fallback
}

const parseRates = (value: string | true | undefined): ReadonlyArray<number> => {
  if (value === undefined) {
    return [0, 200, 500, 1000]
  }
  if (value === true) {
    return []
  }
  return value
    .split(",")
    .map((segment) => Number(segment.trim()))
    .filter((rate) => Number.isFinite(rate) && rate >= 0)
}

const parseOptions = (argv: ReadonlyArray<string>): MatrixOptions => {
  const args = parseCliArgs(argv)
  const options: MatrixOptions = {
    durationSec: asNumber(args.durationSec, 20),
    reportEverySec: asNumber(args.reportEverySec, 5),
    trials: asNumber(args.trials, 5),
    warmupTrials: asNumber(args.warmupTrials, 1),
    outDir: args.outDir === undefined || args.outDir === true ? "tmp/benchmarks" : args.outDir,
    replayFile:
      args.replayFile === undefined || args.replayFile === true
        ? "examples/fixtures/jetstream-sample.ndjson"
        : args.replayFile,
    replayRates: parseRates(args.rates),
    includeDecode: !asBoolean(args.skipDecode, false),
    includePipeline: !asBoolean(args.skipPipeline, false)
  }

  if (!Number.isInteger(options.trials) || options.trials <= 0) {
    throw new Error(`--trials must be a positive integer (received: ${options.trials})`)
  }
  if (!Number.isInteger(options.warmupTrials) || options.warmupTrials < 0) {
    throw new Error(`--warmupTrials must be a non-negative integer (received: ${options.warmupTrials})`)
  }
  if (!Number.isInteger(options.durationSec) || options.durationSec <= 0) {
    throw new Error(`--durationSec must be a positive integer (received: ${options.durationSec})`)
  }
  if (!Number.isInteger(options.reportEverySec) || options.reportEverySec <= 0) {
    throw new Error(`--reportEverySec must be a positive integer (received: ${options.reportEverySec})`)
  }
  if (options.replayRates.length === 0) {
    throw new Error("No replay rates were provided. Use --rates with at least one value.")
  }
  return options
}

const formatRateLabel = (rate: number): string =>
  Number.isInteger(rate) ? `${rate}` : `${rate}`.replace(".", "_")

const buildScenarios = (options: MatrixOptions): ReadonlyArray<Scenario> => {
  const scenarios: Array<Scenario> = []
  if (options.includeDecode) {
    scenarios.push({
      kind: "decode",
      name: "decode-only",
      description: "Raw decode throughput (no socket/mailbox path)"
    })
  }
  for (const replayRate of options.replayRates) {
    const rateLabel = replayRate === 0 ? "max" : formatRateLabel(replayRate)
    scenarios.push({
      kind: "harness",
      name: `replay-${rateLabel}`,
      description: replayRate === 0 ? "Harness replay at max speed" : `Harness replay rate=${replayRate}/sec`,
      args: [
        "--mode",
        "replay",
        "--durationSec",
        `${options.durationSec}`,
        "--reportEverySec",
        `${options.reportEverySec}`,
        "--replayRatePerSec",
        `${replayRate}`,
        "--replayFile",
        options.replayFile
      ]
    })
    if (options.includePipeline) {
      scenarios.push({
        kind: "pipeline",
        name: `pipeline-${rateLabel}`,
        description:
          replayRate === 0
            ? "Jetstream pipeline at max speed (fake websocket)"
            : `Jetstream pipeline rate=${replayRate}/sec (fake websocket)`,
        replayRatePerSec: replayRate
      })
    }
  }
  return scenarios
}

const loadReplayLines = async (path: string): Promise<ReadonlyArray<string>> => {
  const text = await Bun.file(path).text()
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

const createDecodeReport = ({
  events,
  decodeErrors,
  startedAtMs,
  endedAtMs
}: {
  readonly events: number
  readonly decodeErrors: number
  readonly startedAtMs: number
  readonly endedAtMs: number
}): TrialReport => {
  const runtimeSeconds = Math.max(0.001, (endedAtMs - startedAtMs) / 1000)
  const avgEventsPerSec = events / runtimeSeconds
  return {
    mode: "decode",
    runtimeSeconds,
    totals: {
      events,
      decodeErrors,
      inboundDrops: 0,
      mailboxDrops: 0,
      ingressDrops: 0,
      reconnects: 0,
      outboundEncodeFailures: 0,
      outboundSendFailures: 0
    },
    rates: {
      avgEventsPerSec,
      windowEventsPerSec: avgEventsPerSec
    },
    lagMs: {
      p95: null,
      p99: null
    }
  }
}

const createPipelineReport = ({
  events,
  decodeErrors,
  mailboxDrops,
  ingressDrops,
  reconnects,
  startedAtMs,
  endedAtMs
}: {
  readonly events: number
  readonly decodeErrors: number
  readonly mailboxDrops: number
  readonly ingressDrops: number
  readonly reconnects: number
  readonly startedAtMs: number
  readonly endedAtMs: number
}): TrialReport => {
  const runtimeSeconds = Math.max(0.001, (endedAtMs - startedAtMs) / 1000)
  const avgEventsPerSec = events / runtimeSeconds
  const inboundDrops = mailboxDrops + ingressDrops
  return {
    mode: "pipeline",
    runtimeSeconds,
    totals: {
      events,
      decodeErrors,
      inboundDrops,
      mailboxDrops,
      ingressDrops,
      reconnects,
      outboundEncodeFailures: 0,
      outboundSendFailures: 0
    },
    rates: {
      avgEventsPerSec,
      windowEventsPerSec: avgEventsPerSec
    },
    lagMs: {
      p95: null,
      p99: null
    }
  }
}

const runDecodeTrial = async (
  scenario: Scenario & { readonly kind: "decode" },
  trial: number,
  warmup: boolean,
  options: MatrixOptions,
  replayLines: ReadonlyArray<string>,
  reportsDir: string
): Promise<TrialResult> => {
  const reportPath = join(reportsDir, `${scenario.name}-trial-${trial}.json`)
  const startedAtMs = Date.now()
  const deadline = startedAtMs + options.durationSec * 1000
  let index = 0
  let events = 0
  let decodeErrors = 0

  while (Date.now() < deadline) {
    const line = replayLines[index % replayLines.length]
    if (line === undefined) {
      break
    }
    const decoded = Effect.runSyncExit(decodeMessage(line))
    if (Exit.isSuccess(decoded)) {
      events++
    } else {
      decodeErrors++
    }
    index++
  }

  const endedAtMs = Date.now()
  const report = createDecodeReport({
    events,
    decodeErrors,
    startedAtMs,
    endedAtMs
  })
  await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`)

  return {
    scenario: scenario.name,
    trial,
    warmup,
    elapsedMs: endedAtMs - startedAtMs,
    reportPath,
    report
  }
}

const normalizeHarnessReport = (raw: unknown): TrialReport => {
  const candidate = raw as Partial<TrialReport>
  if (
    candidate.rates === undefined ||
    candidate.totals === undefined ||
    candidate.lagMs === undefined ||
    typeof candidate.runtimeSeconds !== "number"
  ) {
    throw new Error("Harness report did not include expected fields")
  }
  return {
    mode: "replay",
    runtimeSeconds: candidate.runtimeSeconds,
    totals: {
      mailboxDrops: candidate.totals.mailboxDrops ?? 0,
      ingressDrops: candidate.totals.ingressDrops ?? 0,
      events: candidate.totals.events ?? 0,
      decodeErrors: candidate.totals.decodeErrors ?? 0,
      inboundDrops:
        candidate.totals.inboundDrops ??
        (candidate.totals.mailboxDrops ?? 0) + (candidate.totals.ingressDrops ?? 0),
      reconnects: candidate.totals.reconnects ?? 0,
      outboundEncodeFailures: candidate.totals.outboundEncodeFailures ?? 0,
      outboundSendFailures: candidate.totals.outboundSendFailures ?? 0
    },
    rates: {
      avgEventsPerSec: candidate.rates.avgEventsPerSec ?? 0,
      windowEventsPerSec: candidate.rates.windowEventsPerSec ?? 0
    },
    lagMs: {
      p95: candidate.lagMs.p95 ?? null,
      p99: candidate.lagMs.p99 ?? null
    }
  }
}

const runHarnessTrial = async (
  scenario: Scenario & { readonly kind: "harness" },
  trial: number,
  warmup: boolean,
  reportsDir: string
): Promise<TrialResult> => {
  const reportPath = join(reportsDir, `${scenario.name}-trial-${trial}.json`)
  const cmd = ["bun", "run", "examples/harness.ts", ...scenario.args, "--jsonOut", reportPath]
  const startedAtMs = Date.now()
  const run = Bun.spawnSync({
    cmd,
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe"
  })
  const endedAtMs = Date.now()

  if (run.exitCode !== 0) {
    const stdout = decoder.decode(run.stdout)
    const stderr = decoder.decode(run.stderr)
    return {
      scenario: scenario.name,
      trial,
      warmup,
      elapsedMs: endedAtMs - startedAtMs,
      reportPath,
      error: `Harness exited with code ${run.exitCode}\n${stdout}\n${stderr}`.trim()
    }
  }

  const rawReport = await Bun.file(reportPath).json()
  const report = normalizeHarnessReport(rawReport)
  return {
    scenario: scenario.name,
    trial,
    warmup,
    elapsedMs: endedAtMs - startedAtMs,
    reportPath,
    report
  }
}

const runPipelineTrial = async (
  scenario: Scenario & { readonly kind: "pipeline" },
  trial: number,
  warmup: boolean,
  options: MatrixOptions,
  replayLines: ReadonlyArray<string>,
  reportsDir: string
): Promise<TrialResult> => {
  const reportPath = join(reportsDir, `${scenario.name}-trial-${trial}.json`)
  const startedAtMs = Date.now()

  let events = 0
  let decodeErrors = 0
  let mailboxDrops = 0
  let ingressDrops = 0
  let reconnects = 0

  const runtimeObserver = (event: JetstreamRuntimeEvent): Effect.Effect<void> =>
    Effect.sync(() => {
      switch (event._tag) {
        case "DecodeFailed":
          decodeErrors += 1
          break
        case "InboundDropped":
          mailboxDrops += 1
          break
        case "IngressDropped":
          ingressDrops += 1
          break
        case "ConnectionClosed":
          reconnects += 1
          break
        default:
          return
      }
    })

  const config = JetstreamConfig.make({
    inboundBufferStrategy: "dropping",
    ingressBufferStrategy: "dropping",
    runtimeObserverBufferSize: 4096,
    runtimeObserver
  })

  const wsLayer = fakeWebSocketLayer
  const layers = [
    wsLayer,
    jetstreamLayer(config).pipe(Layer.provide(wsLayer))
  ] as const

  const program = Effect.gen(function* () {
    const jetstream = yield* JetstreamTag
    const factory = yield* FakeWebSocketFactory
    const streamFiber = yield* jetstream.stream.pipe(
      Stream.runForEach(() =>
        Effect.sync(() => {
          events += 1
        })
      ),
      Effect.fork
    )
    const socket = yield* factory.take
    socket.open()

    const deadline = Date.now() + options.durationSec * 1000
    const delayMs = scenario.replayRatePerSec > 0
      ? 1000 / scenario.replayRatePerSec
      : 0
    let index = 0

    while (Date.now() < deadline) {
      const line = replayLines[index % replayLines.length]
      if (line === undefined) {
        break
      }
      socket.emitMessage(line)
      index++
      if (delayMs > 0) {
        yield* Effect.sleep(delayMs)
      } else if (index % 1000 === 0) {
        yield* Effect.yieldNow()
      }
    }

    yield* jetstream.shutdown
    yield* Fiber.join(streamFiber)
  }).pipe(
    Effect.provide(layers)
  )

  const exit = await Effect.runPromiseExit(program)
  const endedAtMs = Date.now()
  if (Exit.isFailure(exit)) {
    return {
      scenario: scenario.name,
      trial,
      warmup,
      elapsedMs: endedAtMs - startedAtMs,
      reportPath,
      error: Cause.pretty(exit.cause)
    }
  }

  const report = createPipelineReport({
    events,
    decodeErrors,
    mailboxDrops,
    ingressDrops,
    reconnects,
    startedAtMs,
    endedAtMs
  })
  await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`)

  return {
    scenario: scenario.name,
    trial,
    warmup,
    elapsedMs: endedAtMs - startedAtMs,
    reportPath,
    report
  }
}

const quantile = (values: ReadonlyArray<number>, q: number): number => {
  if (values.length === 0) {
    return Number.NaN
  }
  const sorted = [...values].sort((left, right) => left - right)
  const index = (sorted.length - 1) * q
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const lowerValue = sorted[lower] ?? sorted[sorted.length - 1] ?? Number.NaN
  const upperValue = sorted[upper] ?? lowerValue
  if (lower === upper) {
    return lowerValue
  }
  const weight = index - lower
  return lowerValue + (upperValue - lowerValue) * weight
}

const computeStats = (values: ReadonlyArray<number>): Stats | null => {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].sort((left, right) => left - right)
  const sum = values.reduce((acc, value) => acc + value, 0)
  return {
    min: sorted[0] ?? Number.NaN,
    max: sorted[sorted.length - 1] ?? Number.NaN,
    mean: sum / values.length,
    median: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95)
  }
}

const isMeasuredSuccess = (
  result: TrialResult
): result is TrialResult & { readonly report: TrialReport } =>
  !result.warmup && result.report !== undefined && result.error === undefined

const summarizeScenario = (
  scenario: Scenario,
  results: ReadonlyArray<TrialResult>
): ScenarioSummary => {
  const scenarioResults = results.filter((result) => result.scenario === scenario.name)
  const measured = scenarioResults.filter(isMeasuredSuccess)
  const failedTrials = scenarioResults.filter((result) => !result.warmup && result.error !== undefined).length

  const avgEventsPerSec = measured.map((result) => result.report.rates.avgEventsPerSec)
  const windowEventsPerSec = measured.map((result) => result.report.rates.windowEventsPerSec)
  const lagP95 = measured
    .map((result) => result.report.lagMs.p95)
    .filter((value): value is number => value !== null)
  const lagP99 = measured
    .map((result) => result.report.lagMs.p99)
    .filter((value): value is number => value !== null)
  const decodeErrors = measured.map((result) => result.report.totals.decodeErrors)
  const inboundDrops = measured.map((result) => result.report.totals.inboundDrops)
  const mailboxDrops = measured.map((result) => result.report.totals.mailboxDrops)
  const ingressDrops = measured.map((result) => result.report.totals.ingressDrops)
  const reconnects = measured.map((result) => result.report.totals.reconnects)

  return {
    name: scenario.name,
    description: scenario.description,
    measuredTrials: measured.length,
    failedTrials,
    rates: {
      avgEventsPerSec: computeStats(avgEventsPerSec),
      windowEventsPerSec: computeStats(windowEventsPerSec)
    },
    lagMs: {
      p95: computeStats(lagP95),
      p99: computeStats(lagP99)
    },
    totals: {
      decodeErrors: computeStats(decodeErrors),
      inboundDrops: computeStats(inboundDrops),
      mailboxDrops: computeStats(mailboxDrops),
      ingressDrops: computeStats(ingressDrops),
      reconnects: computeStats(reconnects)
    }
  }
}

const formatNumber = (value: number | null | undefined): string =>
  value === null || value === undefined || Number.isNaN(value) ? "n/a" : value.toFixed(2)

const resolveGitSha = (): string => {
  const run = Bun.spawnSync({
    cmd: ["git", "rev-parse", "--short", "HEAD"],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe"
  })
  if (run.exitCode !== 0) {
    return "unknown"
  }
  const sha = decoder.decode(run.stdout).trim()
  return sha.length > 0 ? sha : "unknown"
}

const toRunId = (gitSha: string): string =>
  `${new Date().toISOString().replace(/[:.]/g, "-")}-${gitSha}`

const renderMarkdownSummary = ({
  runId,
  runDir,
  gitSha,
  options,
  scenarioSummaries
}: {
  readonly runId: string
  readonly runDir: string
  readonly gitSha: string
  readonly options: MatrixOptions
  readonly scenarioSummaries: ReadonlyArray<ScenarioSummary>
}): string => {
  const cpuModel = cpus()[0]?.model ?? "unknown"
  const lines = [
    "# Benchmark Matrix",
    "",
    `- Run ID: ${runId}`,
    `- Generated: ${new Date().toISOString()}`,
    `- Git SHA: ${gitSha}`,
    `- Bun: ${Bun.version}`,
    `- Platform: ${process.platform}/${process.arch}`,
    `- CPU: ${cpuModel}`,
    `- Trials: ${options.trials} (warmup excluded: ${options.warmupTrials})`,
    `- Duration per trial: ${options.durationSec}s`,
    `- Output directory: ${runDir}`,
    "",
    "## Scenario Summary",
    "",
    "| Scenario | Measured | Failed | Median avg EPS | P95 avg EPS | Median window EPS | Median p95 lag (ms) | Median p99 lag (ms) | Max decode errors | Max drops | Max mailbox drops | Max ingress drops |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
  ]

  for (const summary of scenarioSummaries) {
    lines.push(
      `| ${summary.name} | ${summary.measuredTrials} | ${summary.failedTrials} | ${formatNumber(summary.rates.avgEventsPerSec?.median)} | ${formatNumber(summary.rates.avgEventsPerSec?.p95)} | ${formatNumber(summary.rates.windowEventsPerSec?.median)} | ${formatNumber(summary.lagMs.p95?.median)} | ${formatNumber(summary.lagMs.p99?.median)} | ${formatNumber(summary.totals.decodeErrors?.max)} | ${formatNumber(summary.totals.inboundDrops?.max)} | ${formatNumber(summary.totals.mailboxDrops?.max)} | ${formatNumber(summary.totals.ingressDrops?.max)} |`
    )
  }

  lines.push("")
  return `${lines.join("\n")}\n`
}

const main = async (): Promise<void> => {
  const options = parseOptions(process.argv.slice(2))
  const gitSha = resolveGitSha()
  const runId = toRunId(gitSha)
  const runDir = join(options.outDir, runId)
  const reportsDir = join(runDir, "reports")
  await mkdir(reportsDir, { recursive: true })

  const scenarios = buildScenarios(options)
  const replayLines = options.includeDecode || options.includePipeline
    ? await loadReplayLines(options.replayFile)
    : []

  const trialResults: Array<TrialResult> = []
  const totalTrials = options.warmupTrials + options.trials

  console.log(`[matrix] runId=${runId}`)
  console.log(`[matrix] scenarios=${scenarios.map((scenario) => scenario.name).join(",")}`)
  console.log(`[matrix] trials=${options.trials} warmup=${options.warmupTrials} duration=${options.durationSec}s`)

  for (const scenario of scenarios) {
    for (let trial = 1; trial <= totalTrials; trial++) {
      const warmup = trial <= options.warmupTrials
      let result: TrialResult
      switch (scenario.kind) {
        case "decode":
          result = await runDecodeTrial(scenario, trial, warmup, options, replayLines, reportsDir)
          break
        case "harness":
          result = await runHarnessTrial(scenario, trial, warmup, reportsDir)
          break
        case "pipeline":
          result = await runPipelineTrial(scenario, trial, warmup, options, replayLines, reportsDir)
          break
      }

      trialResults.push(result)

      if (result.error !== undefined) {
        console.error(
          `[matrix] ${scenario.name} trial=${trial}/${totalTrials} warmup=${warmup} FAILED`
        )
      } else if (result.report !== undefined) {
        console.log(
          `[matrix] ${scenario.name} trial=${trial}/${totalTrials} warmup=${warmup} eps=${result.report.rates.avgEventsPerSec.toFixed(2)}`
        )
      }
    }
  }

  const scenarioSummaries = scenarios.map((scenario) => summarizeScenario(scenario, trialResults))
  const failureCount = trialResults.filter((result) => !result.warmup && result.error !== undefined).length

  const summary = {
    runId,
    generatedAt: new Date().toISOString(),
    gitSha,
    bunVersion: Bun.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpus()[0]?.model ?? "unknown",
    options,
    scenarioSummaries,
    trialResults
  }

  const summaryJsonPath = join(runDir, "matrix-summary.json")
  const summaryMdPath = join(runDir, "matrix-summary.md")
  await Bun.write(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`)
  await Bun.write(
    summaryMdPath,
    renderMarkdownSummary({
      runId,
      runDir,
      gitSha,
      options,
      scenarioSummaries
    })
  )

  console.log(`[matrix] summary json: ${summaryJsonPath}`)
  console.log(`[matrix] summary md: ${summaryMdPath}`)

  if (failureCount > 0) {
    throw new Error(`Benchmark matrix finished with ${failureCount} failed measured trial(s).`)
  }
}

void main().catch((error) => {
  console.error(`[matrix] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
