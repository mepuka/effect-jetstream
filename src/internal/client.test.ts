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
