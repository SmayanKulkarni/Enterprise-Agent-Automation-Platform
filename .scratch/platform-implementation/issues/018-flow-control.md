# 018: Flow control

**Source spec:** [Effect intent, idempotency and Capability Gateway core specification, source slice 4.4](../../../docs/superpowers/specs/2026-09-14-04-effects-gateway-core-spec.md#ordered-implementation-slices)

**What to build:** Add independently bounded concurrency, queue, throughput and provider-quota controls with deadline/cancellation semantics, backpressure and Tenant-filtered availability signals.

**Blocked by:** 017: Attempt/receipt/reconcile

**Status:** complete (local fake-adapter evidence)

**Produces:** M4 effect-to-receipt/reconciliation gate plus `capability.throttle-state` and availability interfaces

- [x] Load tests keep queue depth, in-flight work and retry rate within configured limits and expose safe throttle/availability guidance keyed by the true quota identity.
- [x] Unknown quota identity uses the safest shared bucket; malformed retry hints, cancellation or timeout after possible send, budget exhaustion and overload cannot bypass reconciliation or grow unbounded.
- [x] Publish M4 fake success and unknown-repair run, quota/load measurements, cancellation matrix, throttle-state records, joined timelines and Tenant/secret scans.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `tests/platform/gateway-browser.test.ts`; root manifest slice `018-flow-control`.
