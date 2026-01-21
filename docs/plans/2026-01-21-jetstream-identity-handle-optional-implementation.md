# Jetstream Identity Handle Optional Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow identity events without a handle to decode by making `handle` optional in the identity schemas and adding decoder tests.

**Architecture:** Keep the existing event envelope and union types. Update the public `IdentityEvent` schema and the decoder's raw `Identity` schema to make `handle` optional, then add a failing decoder test for missing handles and verify it passes after the change. Preserve strict validation for other fields.

**Tech Stack:** Bun, Effect Schema, bun:test

### Task 1: Review Effect guidance for schema changes

**Files:**
- None

**Step 1: List Effect guides**

Run: `effect-solutions list`  
Expected: A list of available Effect guides.

**Step 2: Read data modeling guidance**

Run: `effect-solutions show data-modeling`  
Expected: Guidance on Schema data modeling patterns.

### Task 2: Deep dive into Effect source and local usage

**Files:**
- Review: `node_modules/effect/src/Schema.ts`
- Review: `src/JetstreamMessage.ts`
- Review: `src/internal/decoder.ts`
- Review: `src/internal/decoder.test.ts`

**Step 1: Inspect Effect optional property handling**

Run: `rg -n "optional" node_modules/effect/src/Schema.ts`  
Expected: Locations for optional property signature handling.

Run: `sed -n '2410,2485p' node_modules/effect/src/Schema.ts`  
Expected: Definitions for `Schema.optional` property signatures.

**Step 2: Review local identity event schemas**

Run: `rg -n "IdentityEvent|identity\\.|handle" src`  
Expected: Locations for identity event schema and tests.

Run: `sed -n '50,90p' src/JetstreamMessage.ts`  
Expected: `IdentityEvent` schema with required `handle`.

Run: `sed -n '20,70p' src/internal/decoder.ts`  
Expected: Decoder `Identity` schema with required `handle`.

Run: `sed -n '55,95p' src/internal/decoder.test.ts`  
Expected: Identity event test that currently expects a handle string.

### Task 3: Add failing decoder test for missing handle

**Files:**
- Modify: `src/internal/decoder.test.ts`
- Test: `src/internal/decoder.test.ts`

**Step 1: Write the failing test**

Add a test like:

```ts
  test("decodes IdentityEvent without handle", async () => {
    const raw = JSON.stringify({
      did: "did:plc:hslv64eax7d2lwrm7qtg44ud",
      time_us: 17374587134000000,
      kind: "identity",
      identity: {
        did: "did:plc:hslv64eax7d2lwrm7qtg44ud",
        seq: 17374587134,
        time: "2026-01-21T12:45:41.876Z"
      }
    })

    const result = await Effect.runPromise(decodeMessage(raw))

    expect(result._tag).toBe("IdentityEvent")
    if (result._tag === "IdentityEvent") {
      expect(result.identity.handle).toBeUndefined()
    }
  })
```

**Step 2: Run test to verify it fails**

Run: `bun test src/internal/decoder.test.ts`  
Expected: FAIL with a schema validation error for missing `identity.handle`.

### Task 4: Make identity handle optional in schemas

**Files:**
- Modify: `src/JetstreamMessage.ts`
- Modify: `src/internal/decoder.ts`

**Step 1: Update IdentityEvent schema**

Change to:

```ts
  identity: Schema.Struct({
    did: Did,
    handle: Schema.optional(Schema.String),
    seq: Schema.Number,
    time: Schema.String
  })
```

**Step 2: Update decoder Identity schema**

Change to:

```ts
const Identity = Schema.Struct({
  did: Did,
  handle: Schema.optional(Schema.String),
  seq: Schema.Number,
  time: Schema.String
})
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
git commit -m "Make identity handle optional"
```
