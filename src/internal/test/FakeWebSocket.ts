/**
 * @since 1.1.0
 */
import type { DurationInput } from "effect/Duration"
import type * as Chunk from "effect/Chunk"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as TestContext from "effect/TestContext"
import * as Socket from "@effect/platform/Socket"

type EventHandler = (event: {
  readonly data?: string | Uint8Array
  readonly code?: number
  readonly reason?: string
  readonly error?: unknown
}) => void

type ListenerEntry = {
  readonly handler: EventHandler
  readonly once: boolean
}

/**
 * @since 1.1.0
 * @category models
 */
export class FakeWebSocket {
  readonly url: string
  readonly protocols: string | Array<string> | undefined
  readyState = 0
  readonly sent: Array<string | Uint8Array> = []
  private readonly listeners = new Map<string, Array<ListenerEntry>>()
  private errorOnSend: unknown | undefined
  private closeOnSend: { readonly code?: number; readonly reason?: string } | undefined

  constructor(url: string, protocols?: string | Array<string>) {
    this.url = url
    this.protocols = protocols
  }

  addEventListener(type: string, handler: EventHandler, options?: { readonly once?: boolean }): void {
    const existing = this.listeners.get(type) ?? []
    const entry = { handler, once: options?.once ?? false }
    existing.push(entry)
    this.listeners.set(type, existing)
  }

  removeEventListener(type: string, handler: EventHandler): void {
    const existing = this.listeners.get(type)
    if (!existing) {
      return
    }
    const next = existing.filter((entry) => entry.handler !== handler)
    if (next.length === 0) {
      this.listeners.delete(type)
    } else {
      this.listeners.set(type, next)
    }
  }

  send(data: string | Uint8Array): void {
    this.sent.push(data)
    if (this.errorOnSend !== undefined) {
      const error = this.errorOnSend
      this.errorOnSend = undefined
      this.emitError(error)
    }
    if (this.closeOnSend) {
      const { code, reason } = this.closeOnSend
      this.closeOnSend = undefined
      this.close(code, reason)
    }
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === 3) {
      return
    }
    this.readyState = 3
    this.dispatch("close", { code, reason })
  }

  open(): void {
    this.readyState = 1
    this.dispatch("open", {})
  }

  emitMessage(data: string | Uint8Array): void {
    this.dispatch("message", { data })
  }

  emitError(error: unknown): void {
    this.dispatch("error", { error })
  }

  failNextSend(error: unknown): void {
    this.errorOnSend = error
  }

  closeOnNextSend(code?: number, reason?: string): void {
    this.closeOnSend = {
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason })
    }
  }

  private dispatch(type: string, event: { readonly data?: string | Uint8Array; readonly code?: number; readonly reason?: string; readonly error?: unknown }): void {
    const existing = this.listeners.get(type)
    if (!existing || existing.length === 0) {
      return
    }
    const remaining: Array<ListenerEntry> = []
    for (const entry of existing) {
      entry.handler(event)
      if (!entry.once) {
        remaining.push(entry)
      }
    }
    if (remaining.length === 0) {
      this.listeners.delete(type)
    } else {
      this.listeners.set(type, remaining)
    }
  }
}

/**
 * @since 1.1.0
 * @category models
 */
export interface FakeWebSocketFactory {
  readonly constructor: (url: string, protocols?: string | Array<string>) => FakeWebSocket
  readonly take: Effect.Effect<FakeWebSocket>
  readonly takeAll: Effect.Effect<Chunk.Chunk<FakeWebSocket>>
}

/**
 * @since 1.1.0
 * @category tags
 */
export const FakeWebSocketFactory = Context.GenericTag<FakeWebSocketFactory>(
  "effect-jetstream/test/FakeWebSocketFactory"
)

const makeFactory = Effect.gen(function* () {
  const created = yield* Queue.unbounded<FakeWebSocket>()
  const constructor = (url: string, protocols?: string | Array<string>) => {
    const socket = new FakeWebSocket(url, protocols)
    created.unsafeOffer(socket)
    return socket
  }
  return FakeWebSocketFactory.of({
    constructor,
    take: Queue.take(created),
    takeAll: Queue.takeAll(created)
  })
})

/**
 * @since 1.1.0
 * @category layers
 */
const factoryLayer = Layer.effect(FakeWebSocketFactory, makeFactory)
const socketLayer = Layer.effect(
  Socket.WebSocketConstructor,
  Effect.map(FakeWebSocketFactory, (factory) =>
    (url: string, protocols?: string | Array<string>) =>
      factory.constructor(url, protocols) as unknown as globalThis.WebSocket
  )
)

export const layer = Layer.provideMerge(socketLayer, factoryLayer)

/**
 * @since 1.1.0
 * @category layers
 */
export const testLayer = Layer.merge(TestContext.TestContext, layer)

/**
 * @since 1.1.0
 * @category helpers
 */
export const openAfter = (socket: FakeWebSocket, duration: DurationInput): Effect.Effect<void> =>
  Effect.sleep(duration).pipe(Effect.zipRight(Effect.sync(() => socket.open())))

/**
 * @since 1.1.0
 * @category helpers
 */
export const closeAfter = (socket: FakeWebSocket, duration: DurationInput, code?: number, reason?: string): Effect.Effect<void> =>
  Effect.sleep(duration).pipe(Effect.zipRight(Effect.sync(() => socket.close(code, reason))))

/**
 * @since 1.1.0
 * @category helpers
 */
export const emitMessageAfter = (
  socket: FakeWebSocket,
  duration: DurationInput,
  data: string | Uint8Array
): Effect.Effect<void> =>
  Effect.sleep(duration).pipe(Effect.zipRight(Effect.sync(() => socket.emitMessage(data))))
