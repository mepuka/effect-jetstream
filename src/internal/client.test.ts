import { describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { JetstreamConfig } from "../JetstreamConfig.js"
import { layer as clientLayer, tag as JetstreamClientTag } from "./client.js"
import { layer as jetstreamLayer, tag as JetstreamTag } from "./jetstream.js"
import { FakeWebSocketFactory, testLayer as fakeWebSocketLayer } from "./test/FakeWebSocket.js"

const makeLayer = (config: JetstreamConfig) => {
  const wsLayer = fakeWebSocketLayer
  const streamLayer = jetstreamLayer(config).pipe(Layer.provide(wsLayer))
  return [
    wsLayer,
    streamLayer,
    clientLayer.pipe(Layer.provide(streamLayer))
  ] as const
}

describe("jetstream client", () => {
  test("reuses decoded create event across handlers for same collection", async () => {
    const config = JetstreamConfig.make({})
    const program = Effect.gen(function* () {
      const client = yield* JetstreamClientTag
      const jetstream = yield* JetstreamTag
      const factory = yield* FakeWebSocketFactory
      const seen: Array<unknown> = []

      yield* client.onCreate("app.bsky.feed.post", (event) =>
        Effect.sync(() => {
          seen.push(event)
        })
      )
      yield* client.onCreate("app.bsky.feed.post", (event) =>
        Effect.sync(() => {
          seen.push(event)
        })
      )

      const runFiber = yield* client.run.pipe(Effect.fork)
      const socket = yield* factory.take
      socket.open()
      socket.emitMessage(JSON.stringify({
        did: "did:plc:abc123",
        time_us: 1725911162329308,
        kind: "commit",
        commit: {
          rev: "3l3qo2vutsw2b",
          operation: "create",
          collection: "app.bsky.feed.post",
          rkey: "3l3qo2vuowo2b",
          record: {
            $type: "app.bsky.feed.post",
            text: "hello",
            createdAt: "2024-09-09T19:46:02.102Z"
          }
        }
      }))
      yield* Effect.yieldNow()
      yield* Effect.yieldNow()
      yield* jetstream.shutdown
      yield* Fiber.join(runFiber)
      return seen
    }).pipe(Effect.provide(makeLayer(config)))

    const seen = await Effect.runPromise(program)
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1])
  })

  test("run completes when stream shuts down", async () => {
    const config = JetstreamConfig.make({})
    const program = Effect.gen(function* () {
      const client = yield* JetstreamClientTag
      const jetstream = yield* JetstreamTag
      const factory = yield* FakeWebSocketFactory

      const runFiber = yield* client.run.pipe(Effect.fork)
      const socket = yield* factory.take
      socket.open()

      yield* jetstream.shutdown
      return yield* Fiber.await(runFiber)
    }).pipe(Effect.provide(makeLayer(config)))

    const exit = await Effect.runPromise(program)
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  test("runForever remains pending after shutdown", async () => {
    const config = JetstreamConfig.make({})
    const program = Effect.gen(function* () {
      const client = yield* JetstreamClientTag
      const jetstream = yield* JetstreamTag
      const factory = yield* FakeWebSocketFactory

      const runFiber = yield* client.runForever.pipe(Effect.fork)
      const socket = yield* factory.take
      socket.open()

      yield* jetstream.shutdown
      const stillRunning = Option.isNone(yield* Fiber.poll(runFiber))
      yield* Fiber.interrupt(runFiber)
      return stillRunning
    }).pipe(Effect.provide(makeLayer(config)))

    const stillRunning = await Effect.runPromise(program)
    expect(stillRunning).toBe(true)
  })
})
