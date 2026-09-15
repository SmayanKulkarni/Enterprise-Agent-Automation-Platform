# 015: Intent/idempotency

**Source spec:** [Effect intent, idempotency and Capability Gateway core specification, source slice 4.1](../../../docs/superpowers/specs/2026-09-14-04-effects-gateway-core-spec.md#ordered-implementation-slices)

**What to build:** Persist authorized Runtime effect intent before any provider access, fencing generation and atomically consuming exact approval while fixing the logical effect ID and first canonical payload digest.

**Blocked by:** 014: Recovery

**Status:** complete (2026-09-15; local intent approval fence)

**Produces:** `case.effect-intent` and `recordEffectIntent` interface

**Execution:** Added `EffectIntentRuntime` with a first canonical payload digest, Tenant/generation/version/authority fence, exact approval callback and durable original receipt reuse before any provider boundary.

- [x] The same idempotency key and digest returns the durable original receipt, and one approved command records exactly one authorized intent before dispatch becomes possible.
- [x] Conflicting digest, stale authority/approval/generation, concurrent consumption and crash around the approval/intent fence deny or replay without an unfenced provider call.
- [x] Publish intent/approval transaction traces, duplicate/conflict/concurrency fixtures, crash results, canonical digests and audit evidence.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.
