import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Did } from "../BlueskyRecord.js"
import { decodeMessage } from "./decoder.js"

describe("decoder", () => {
  test("decodes CommitCreate", async () => {
    const raw = JSON.stringify({
      did: "did:plc:eygmaihciaxprqvxpfvl6flk",
      time_us: 1725911162329308,
      kind: "commit",
      commit: {
        rev: "3l3qo2vutsw2b",
        operation: "create",
        collection: "app.bsky.feed.like",
        rkey: "3l3qo2vuowo2b",
        record: {
          $type: "app.bsky.feed.like",
          createdAt: "2024-09-09T19:46:02.102Z",
          subject: {
            cid: "bafyreidc6sydkkbchcyg62v77wbhzvb2mvytlmsychqgwf2xojjtirmzj4",
            uri: "at://did:plc:wa7b35aakoll7hugkrjtf3xf/app.bsky.feed.post/3l3pte3p2e325"
          }
        },
        cid: "bafyreidwaivazkwu67xztlmuobx35hs2lnfh3kolmgfmucldvhd3sgzcqi"
      }
    })

    const result = await Effect.runPromise(decodeMessage(raw))
    
    expect(result._tag).toBe("CommitCreate")
    expect(result.did).toBe("did:plc:eygmaihciaxprqvxpfvl6flk" as Did)
    expect(result.time_us).toBe(1725911162329308)
    if (result._tag === "CommitCreate") {
      expect(result.commit.operation).toBe("create")
      expect(result.commit.collection).toBe("app.bsky.feed.like")
    }
  })

  test("decodes CommitDelete", async () => {
    const raw = JSON.stringify({
      did: "did:plc:abc123",
      time_us: 1725911162329308,
      kind: "commit",
      commit: {
        rev: "3l3qo2vutsw2b",
        operation: "delete",
        collection: "app.bsky.feed.post",
        rkey: "3l3qo2vuowo2b"
      }
    })

    const result = await Effect.runPromise(decodeMessage(raw))
    
    expect(result._tag).toBe("CommitDelete")
    if (result._tag === "CommitDelete") {
      expect(result.commit.operation).toBe("delete")
    }
  })

  test("decodes IdentityEvent", async () => {
    const raw = JSON.stringify({
      did: "did:plc:ufbl4k27gp6kzas5glhz7fim",
      time_us: 1725516665234703,
      kind: "identity",
      identity: {
        did: "did:plc:ufbl4k27gp6kzas5glhz7fim",
        handle: "yohenrique.bsky.social",
        seq: 1409752997,
        time: "2024-09-05T06:11:04.870Z"
      }
    })

    const result = await Effect.runPromise(decodeMessage(raw))
    
    expect(result._tag).toBe("IdentityEvent")
    if (result._tag === "IdentityEvent") {
      expect(result.identity.handle).toBe("yohenrique.bsky.social")
    }
  })

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

  test("decodes AccountEvent", async () => {
    const raw = JSON.stringify({
      did: "did:plc:ufbl4k27gp6kzas5glhz7fim",
      time_us: 1725516665333808,
      kind: "account",
      account: {
        active: true,
        did: "did:plc:ufbl4k27gp6kzas5glhz7fim",
        seq: 1409753013,
        time: "2024-09-05T06:11:04.870Z"
      }
    })

    const result = await Effect.runPromise(decodeMessage(raw))
    
    expect(result._tag).toBe("AccountEvent")
    if (result._tag === "AccountEvent") {
      expect(result.account.active).toBe(true)
    }
  })

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

  test("fails on invalid JSON", async () => {
    const result = await Effect.runPromiseExit(decodeMessage("not json"))
    
    expect(result._tag).toBe("Failure")
  })

  test("fails on unknown kind", async () => {
    const raw = JSON.stringify({
      did: "did:plc:abc",
      time_us: 123,
      kind: "unknown"
    })
    
    const result = await Effect.runPromiseExit(decodeMessage(raw))
    
    expect(result._tag).toBe("Failure")
  })
})
