import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { summarizeParseError } from "../../src/internal/parseError.js"

const PositiveInteger = Schema.Number.pipe(
  Schema.finite(),
  Schema.int(),
  Schema.greaterThan(0)
)

const NonNegativeNumber = Schema.Number.pipe(
  Schema.finite(),
  Schema.nonNegative()
)

const NonNegativeInteger = Schema.Number.pipe(
  Schema.finite(),
  Schema.int(),
  Schema.nonNegative()
)

export class HarnessOptions extends Schema.Class<HarnessOptions>("HarnessOptions")({
  mode: Schema.optionalWith(Schema.Literal("live", "replay"), { default: () => "live" }),
  durationSec: Schema.optionalWith(PositiveInteger, { default: () => 60 }),
  reportEverySec: Schema.optionalWith(PositiveInteger, { default: () => 5 }),
  jsonOut: Schema.optionalWith(Schema.String, { default: () => "tmp/harness-report.json" }),
  collections: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }),
  dids: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }),
  endpoint: Schema.optionalWith(Schema.String, {
    default: () => "wss://jetstream1.us-east.bsky.network/subscribe"
  }),
  replayFile: Schema.optionalWith(Schema.String, {
    default: () => "examples/fixtures/jetstream-sample.ndjson"
  }),
  replayRatePerSec: Schema.optionalWith(NonNegativeNumber, { default: () => 0 }),
  gateMinEventsPerSec: Schema.optional(NonNegativeNumber),
  gateMaxDecodeErrors: Schema.optional(NonNegativeInteger),
  gateMaxInboundDrops: Schema.optional(NonNegativeInteger),
  gateMaxReconnects: Schema.optional(NonNegativeInteger),
  gateMaxP95LagMs: Schema.optional(NonNegativeNumber)
}) {}

type CliArgs = Record<string, string | true>

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
      const key = segment.slice(0, equalIndex)
      const value = segment.slice(equalIndex + 1)
      parsed[key] = value
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

const asNumber = (value: string | true | undefined): number | undefined => {
  if (value === undefined) {
    return undefined
  }
  if (value === true) {
    return Number.NaN
  }
  return Number(value)
}

const asCsv = (value: string | true | undefined): ReadonlyArray<string> | true | undefined => {
  if (value === undefined || value === true) {
    return value
  }
  const values = value
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
  return values
}

const toRawOptions = (args: CliArgs): Record<string, unknown> => ({
  mode: args.mode,
  durationSec: asNumber(args.durationSec),
  reportEverySec: asNumber(args.reportEverySec),
  jsonOut: args.jsonOut,
  collections: asCsv(args.collections),
  dids: asCsv(args.dids),
  endpoint: args.endpoint,
  replayFile: args.replayFile,
  replayRatePerSec: asNumber(args.replayRatePerSec),
  gateMinEventsPerSec: asNumber(args.gateMinEventsPerSec),
  gateMaxDecodeErrors: asNumber(args.gateMaxDecodeErrors),
  gateMaxInboundDrops: asNumber(args.gateMaxInboundDrops),
  gateMaxReconnects: asNumber(args.gateMaxReconnects),
  gateMaxP95LagMs: asNumber(args.gateMaxP95LagMs)
})

const decodeHarnessOptions = Schema.decodeUnknown(HarnessOptions)

export const parseHarnessOptions = Effect.fn("Harness.parseHarnessOptions")(
  (argv: ReadonlyArray<string>): Effect.Effect<HarnessOptions, Error> =>
    decodeHarnessOptions(toRawOptions(parseCliArgs(argv))).pipe(
      Effect.mapError((error) => new Error(`Invalid harness options: ${summarizeParseError(error)}`))
    )
)
