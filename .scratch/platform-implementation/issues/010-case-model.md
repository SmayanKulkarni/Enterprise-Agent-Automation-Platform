# 010: Case model

**Source spec:** [Durable Case lifecycle, Agent Team and intervention specification, source slice 3.1](../../../docs/superpowers/specs/2026-09-14-03-case-runtime-agent-team-spec.md#ordered-implementation-slices)

**What to build:** Implement pure exhaustive Case command, decision, event and evolution interfaces as the sole model for durable Case state, generation, version, package pin and terminal outcome.

**Blocked by:** 009a: Clerk browser session

**Status:** complete (2026-09-15; deterministic local reducer)

**Produces:** `case.case`, `case.stage`, `case.command`, `case.package-pin` and `case.outcome` reducer interfaces; foundation toward M3

**Execution:** Added the pure exhaustive state/command transition map, deterministic event digesting, Tenant/authority/version/generation fences, idempotency receipts, immutable outcomes and reopen generation rollover. Focused reducer checks and root verification pass.

- [x] Every valid state/command pair produces deterministic events and immutable terminal history, with reopen incrementing generation and accepted commands binding the canonical context and digest.
- [x] Invalid transitions, stale generation/version, duplicate keys with conflicting digests, foreign Tenant references and late mutation of closed outcomes reject without side effects.
- [x] Publish exhaustive reducer transition coverage, model/property seeds, canonical state digests, idempotency receipts and Tenant/authority negatives.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.
