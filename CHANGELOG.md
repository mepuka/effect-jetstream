# effect-jetstream

## 1.2.0

### Minor Changes

- Improve runtime throughput and observability with configurable buffering and reconnect behavior.

  - Add ingress buffering controls and runtime drop visibility (`IngressDropped`) to protect decode/stream delivery under burst load.
  - Add runtime observer queue buffering to prevent observer backpressure from affecting message processing.
  - Add outbound/reconnect tuning (`outboundBufferSize`, reconnect delays, jitter) for production stability tuning.
  - Improve client dispatch efficiency by reusing decoded record payloads across handlers for the same event.
  - Expand benchmark/harness tooling with replay/pipeline matrix scenarios and richer drop attribution metrics.

## 1.1.0

### Minor Changes

- e9b112a: Add runtime observer, inbound buffer configuration, and run/runForever split

  - `run` now returns `Effect<void>` and completes on shutdown; `runForever` blocks forever
  - New `runtimeObserver` config for instrumentation events (connection lifecycle, decode failures, inbound drops, outbound events, shutdown)
  - New `inboundBufferSize` and `inboundBufferStrategy` config options for backpressure control
  - Cross-runtime zstd decoder detection (typed error in non-Bun runtimes instead of crash)
  - Schema-validated outbound message encoding with typed errors
  - Effectful URL building catches invalid endpoints as `ConnectionError`
  - Fix null record check in commit create/update decoding

## 1.0.4

### Patch Changes

- 55997b3: Add Jetstream shutdown for graceful connection termination and stop reconnect loops on shutdown.

## 1.0.3

### Patch Changes

- 8a263b2: Use ArrayFormatter summaries for schema decode errors to keep warning logs concise.

## 1.0.2

### Patch Changes

- fa7e23e: make identity.handle optional in post parsing
