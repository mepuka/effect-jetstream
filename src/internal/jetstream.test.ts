import { describe, expect, test } from "bun:test"
import * as Chunk from "effect/Chunk"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/TestClock"
import { JetstreamConfig } from "../JetstreamConfig.js"
import { FakeWebSocketFactory, testLayer as fakeWebSocketLayer } from "./test/FakeWebSocket.js"
import { tag as JetstreamTag, layer as jetstreamLayer } from "./jetstream.js"

const makeLayer = (config: JetstreamConfig) => {
  const wsLayer = fakeWebSocketLayer
  return [
    wsLayer,
    jetstreamLayer(config).pipe(Layer.provide(wsLayer))
  ] as const
}

describe("jetstream", () => {
  test("drops malformed messages and continues", async () => {
    const config = JetstreamConfig.make({})
    const program = Effect.gen(function* () {
      const jetstream = yield* JetstreamTag
      const factory = yield* FakeWebSocketFactory
      const streamFiber = yield* jetstream.stream.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.fork
      )
      const socket = yield* factory.take
      socket.open()
      socket.emitMessage("not json")
      socket.emitMessage(
        JSON.stringify({
          did: "did:plc:abc123",
          time_us: 1,
          kind: "commit",
          commit: {
            rev: "1",
            operation: "delete",
            collection: "app.bsky.feed.post",
            rkey: "r1"
          }
        })
      )
      const messages = yield* Fiber.join(streamFiber)
      return Chunk.toReadonlyArray(messages)
    }).pipe(Effect.provide(makeLayer(config)))

    const messages = await Effect.runPromise(program)
    expect(messages).toHaveLength(1)
    expect(messages[0]?._tag).toBe("CommitDelete")
  })

  test("send waits for socket open", async () => {
    const config = JetstreamConfig.make({})
    const program = Effect.gen(function* () {
      const jetstream = yield* JetstreamTag
      const factory = yield* FakeWebSocketFactory
      const sendFiber = yield* jetstream.send({
        type: "options_update",
        payload: { wantedCollections: ["app.bsky.feed.post"] }
      }).pipe(Effect.fork)
      const socket = yield* factory.take
      const pendingBeforeOpen = Option.isNone(yield* Fiber.poll(sendFiber))
      socket.open()
      yield* Fiber.join(sendFiber)
      return { pendingBeforeOpen, sent: socket.sent }
    }).pipe(Effect.provide(makeLayer(config)))

    const result = await Effect.runPromise(program)
    expect(result.pendingBeforeOpen).toBe(true)
    expect(result.sent).toHaveLength(1)
  })

  test("retries and resends pending messages after reconnect", async () => {
    const config = JetstreamConfig.make({})
    const program = Effect.gen(function* () {
      const jetstream = yield* JetstreamTag
      const factory = yield* FakeWebSocketFactory
      const sendFiber = yield* jetstream.send({
        type: "options_update",
        payload: { wantedCollections: ["app.bsky.feed.post"] }
      }).pipe(Effect.fork)
      const socket1 = yield* factory.take
      yield* Effect.yieldNow()
      socket1.emitError(new Error("boom"))
      yield* TestClock.adjust("1 second")
      const socket2 = yield* factory.take
      const pendingAfterError = Option.isNone(yield* Fiber.poll(sendFiber))
      socket2.open()
      yield* Fiber.join(sendFiber)
      return {
        pendingAfterError,
        sent1: socket1.sent.length,
        sent2: socket2.sent.length
      }
    }).pipe(Effect.provide(makeLayer(config)))

    const result = await Effect.runPromise(program)
    expect(result.pendingAfterError).toBe(true)
    expect(result.sent1).toBe(0)
    expect(result.sent2).toBe(1)
  })
})
