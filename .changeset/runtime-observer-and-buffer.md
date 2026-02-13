---
"effect-jetstream": minor
---

Add runtime observer, inbound buffer configuration, and run/runForever split

- `run` now returns `Effect<void>` and completes on shutdown; `runForever` blocks forever
- New `runtimeObserver` config for instrumentation events (connection lifecycle, decode failures, inbound drops, outbound events, shutdown)
- New `inboundBufferSize` and `inboundBufferStrategy` config options for backpressure control
- Cross-runtime zstd decoder detection (typed error in non-Bun runtimes instead of crash)
- Schema-validated outbound message encoding with typed errors
- Effectful URL building catches invalid endpoints as `ConnectionError`
- Fix null record check in commit create/update decoding
