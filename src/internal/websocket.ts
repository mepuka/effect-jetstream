/**
 * @since 1.0.0
 */
import * as Socket from "@effect/platform/Socket"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { ConnectionError } from "../JetstreamError.js"
import type { JetstreamConfig } from "../JetstreamConfig.js"

export const buildUrl = (config: JetstreamConfig): string => {
  const url = new URL(config.endpoint)
  
  for (const collection of config.wantedCollections) {
    url.searchParams.append("wantedCollections", collection)
  }
  
  for (const did of config.wantedDids) {
    url.searchParams.append("wantedDids", did)
  }
  
  if (config.cursor !== undefined) {
    url.searchParams.set("cursor", config.cursor.toString())
  }
  
  if (config.maxMessageSizeBytes !== undefined) {
    url.searchParams.set("maxMessageSizeBytes", config.maxMessageSizeBytes.toString())
  }
  
  if (config.compress) {
    url.searchParams.set("compress", "true")
  }
  
  return url.toString()
}

export const createSocket = (
  url: string
): Effect.Effect<Socket.Socket, ConnectionError, Socket.WebSocketConstructor> =>
  Socket.makeWebSocket(url).pipe(
    Effect.mapError((cause) => new ConnectionError({ reason: "Connect", cause }))
  )

export const messageStream = (
  socket: Socket.Socket
): Stream.Stream<string | Uint8Array, ConnectionError> =>
  Stream.async<string | Uint8Array, ConnectionError>((emit) => {
    const run = socket.runRaw(
      (data) => {
        emit.single(data)
      }
    ).pipe(
      Effect.catchAll((error) => 
        Effect.sync(() => {
          emit.fail(new ConnectionError({ reason: "Closed", cause: error }))
        })
      ),
      Effect.ensuring(Effect.sync(() => emit.end()))
    )
    
    return run
  })
