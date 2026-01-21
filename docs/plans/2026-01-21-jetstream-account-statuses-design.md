# Jetstream Account Status Support Design

## Context

Jetstream account events carry a `status` string when `active=false`. The current
schema only allows three statuses, which causes schema validation failures for
other valid values in the ATProto lexicon (e.g. "takendown").

## Goals

- Accept the full set of Jetstream account statuses without changing the public
  API shape.
- Keep strict validation for unknown status values.
- Add decoder tests that cover all valid statuses.

## Non-Goals

- Changing event envelope shapes or the event union.
- Allowing arbitrary status strings.
- Altering client routing/handler behavior.

## Proposed Changes

### Schemas

- Update `AccountEvent` in `src/JetstreamMessage.ts` so `account.status` accepts:
  - takendown
  - suspended
  - deleted
  - deactivated
  - desynchronized
  - throttled

### Decoder

- Mirror the same literal list in `src/internal/decoder.ts` for the `Account`
  schema used by `RawMessage`.
- No change to decoding control flow: only the allowed literal values expand.

### Tests

- Add a table-driven decoder test that confirms all six status values decode to
  `AccountEvent`.
- Add a negative test that an unknown status still fails schema validation.

### Documentation (Optional)

- Note the expanded status set in `README.md` near the `AccountEvent` mention.

## Compatibility

- Backwards compatible; only expands accepted data.
- Existing event consumers see the same `AccountEvent` shape.

## Risks

- Low; only schema literals are expanded. Unknown values still fail.

## Validation Plan

- Run `bun test` to cover the new decoder test cases.
