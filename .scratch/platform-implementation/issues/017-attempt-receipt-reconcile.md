# 017: Attempt/receipt/reconcile

**Source spec:** [Effect intent, idempotency and Capability Gateway core specification, source slice 4.3](../../../docs/superpowers/specs/2026-09-14-04-effects-gateway-core-spec.md#ordered-implementation-slices)

**What to build:** Surround dispatch with durable attempts, safe receipts and checkpoints, then reconcile every crash gap and dispatch-certainty outcome into the owning Case disposition.

**Blocked by:** 016: Invocation/admission

**Status:** complete (local fake-adapter evidence)

**Produces:** `case.effect-attempt`, `case.effect-receipt` and `capability.reconciliation-checkpoint` interfaces

- [x] Success and conclusively resolved unknown outcomes join intent, unique attempt, receipt/checkpoint and Case disposition while preserving at-least-once semantics.
- [x] Post-send timeout/crash, delayed or duplicate receipt, absent provider idempotency and inconclusive lookup remain unknown-outcome or operator-required and never trigger an unsafe retry.
- [x] Publish joined intent/attempt/receipt/checkpoint/audit timelines, dispatch-certainty assertions, retry-owner matrix, crash-gap fixtures and secret scan.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `tests/platform/gateway-browser.test.ts`; root manifest slice `017-attempt-receipt-reconcile`.
