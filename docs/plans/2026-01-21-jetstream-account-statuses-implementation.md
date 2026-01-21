# Jetstream Account Status Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand account event schema validation to accept all six Jetstream account status values and add decoder tests for them.

**Architecture:** Keep the existing event envelope and union types. Update the account status literal list in the public schema and the decoder's raw schema, then add targeted decoder tests for all valid statuses plus an invalid status check.

**Tech Stack:** Bun, Effect Schema, bun:test

### Task 1: Review Effect guidance for schema changes

**Files:**
- None

**Step 1: List Effect guides**

Run: `effect-solutions list`  
Expected: A list of available Effect guides.

**Step 2: Read data modeling guidance**

Run: `effect-solutions show data-modeling`  
Expected: Guidance on schema/data modeling patterns.

### Task 2: Deep dive into Effect source and local usage

**Files:**
- Review: `node_modules/effect/src/Schema.ts`
- Review: `node_modules/effect/src/SchemaAST.ts`
- Review: `src/JetstreamMessage.ts`
- Review: `src/internal/decoder.ts`
- Review: `src/internal/client.ts`

**Step 1: Inspect Effect Schema.Literal source**

Run: `rg -n "Literal" node_modules/effect/src/Schema.ts`  
Expected: Locations for `Literal` definitions/usages in Effect's Schema source.

**Step 2: Review literal AST handling**

Run: `rg -n "Literal" node_modules/effect/src/SchemaAST.ts`  
Expected: Literal-related AST definitions and helpers.

**Step 3: Review local account handling code**

Run: `rg -n "AccountEvent|account\\.|status" src`  
Expected: References to account events, decoder schema, and handler routing.

**Step 4: Read the key local files**

Run: `sed -n '1,200p' src/JetstreamMessage.ts`  
Expected: AccountEvent schema with current status literal list.

Run: `sed -n '1,220p' src/internal/decoder.ts`  
Expected: Decoder schema for account status.

Run: `sed -n '1,240p' src/internal/client.ts`  
Expected: Account event routing logic (no status-specific filtering).

### Task 3: Add failing decoder tests for account statuses

**Files:**
- Modify: `src/internal/decoder.test.ts`
- Test: `src/internal/decoder.test.ts`

**Step 1: Write the failing tests**

Add tests like:

```ts
  test("decodes AccountEvent with all status values", async () => {
    const statuses = [
      "takendown",
      "suspended",
      "deleted",
      "deactivated",
      "desynchronized",
      "throttled"
    ] as const

    for (const status of statuses) {
      const raw = JSON.stringify({
        did: "did:plc:status",
        time_us: 1725516665333808,
        kind: "account",
        account: {
          active: false,
          did: "did:plc:status",
          seq: 1409753013,
          time: "2024-09-05T06:11:04.870Z",
          status
        }
      })

      const result = await Effect.runPromise(decodeMessage(raw))

      expect(result._tag).toBe("AccountEvent")
      if (result._tag === "AccountEvent") {
        expect(result.account.status).toBe(status)
      }
    }
  })

  test("fails on unknown account status", async () => {
    const raw = JSON.stringify({
      did: "did:plc:badstatus",
      time_us: 1725516665333808,
      kind: "account",
      account: {
        active: false,
        did: "did:plc:badstatus",
        seq: 1409753013,
        time: "2024-09-05T06:11:04.870Z",
        status: "shadowbanned"
      }
    })

    const result = await Effect.runPromiseExit(decodeMessage(raw))

    expect(result._tag).toBe("Failure")
  })
```

**Step 2: Run test to verify it fails**

Run: `bun test src/internal/decoder.test.ts`  
Expected: FAIL with a schema validation error for account status.

### Task 4: Update account status literals in schemas

**Files:**
- Modify: `src/JetstreamMessage.ts`
- Modify: `src/internal/decoder.ts`

**Step 1: Update AccountEvent schema**

Change to:

```ts
    status: Schema.optional(
      Schema.Literal(
        "takendown",
        "suspended",
        "deleted",
        "deactivated",
        "desynchronized",
        "throttled"
      )
    )
```

**Step 2: Update decoder Account schema**

Change to:

```ts
  status: Schema.optional(
    Schema.Literal(
      "takendown",
      "suspended",
      "deleted",
      "deactivated",
      "desynchronized",
      "throttled"
    )
  )
```

**Step 3: Run tests to verify they pass**

Run: `bun test src/internal/decoder.test.ts`  
Expected: PASS.

### Task 5: Commit the change

**Files:**
- Modify: `src/JetstreamMessage.ts`
- Modify: `src/internal/decoder.ts`
- Modify: `src/internal/decoder.test.ts`

**Step 1: Commit**

```bash
git add src/JetstreamMessage.ts src/internal/decoder.ts src/internal/decoder.test.ts
git commit -m "Expand account status literals"
```
