# 026: Retrieval

**Source spec:** [Governed memory, provenance and Validated Experience specification, source slice 6.3](../../../docs/superpowers/specs/2026-09-14-06-memory-validated-experience-spec.md#ordered-implementation-slices)

**What to build:** Deliver the memory query/result interface with eligibility prefiltering before ranking, provenance-bearing projection, epoch-safe caches and a declared non-widening fallback across a second retrieval adapter.

**Blocked by:** 025: Scoped stores

**Status:** complete

**Produces:** `memory.query` and `memory.result-provenance` interfaces

- [x] Authorized queries return ranked, bounded results with source/scope/version/redaction provenance and explicit freshness or fallback quality from both adapters.
- [x] Poisoned or stale cache/index, cross-index leakage, orphan/deleted/held/corrected content, budget truncation and adapter outage cannot widen scope or hide reduced quality.
- [x] Publish `memory.query`/result fixtures, adapter parity, cache/index epoch assertions, fallback results, provenance traces and timing/count leakage tests.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `tests/platform/lifecycle-memory.test.ts`; pinned `pnpm verify` passed on 2026-09-15 and published `evidence/implementation/manifest.json`.
