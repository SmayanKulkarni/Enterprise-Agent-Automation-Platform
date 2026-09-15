# 025: Scoped stores

**Source spec:** [Governed memory, provenance and Validated Experience specification, source slice 6.2](../../../docs/superpowers/specs/2026-09-14-06-memory-validated-experience-spec.md#ordered-implementation-slices)

**What to build:** Implement governed memory writes and current-authority reads across explicit Case, activation/package, Tenant, optional Agent Definition and platform scopes using conforming in-memory and relational adapters.

**Blocked by:** 024: Provenance graph

**Status:** complete

**Produces:** `Memory.write` scoped-store interface and first two storage adapters

- [x] Every permitted writer/reader/scope/purpose pair stores and retrieves only records whose authority, policy, consent, classification and retention intersections allow access.
- [x] Cross-Tenant/Case/activation/agent substitution, stale or revoked authority, Tenant-derived platform scope and unscoped repository access deny without timing, count or existence leakage.
- [x] Publish access matrix, adapter parity results, SQL isolation evidence, provenance-bearing write/read samples and leakage/secret tests.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `tests/platform/lifecycle-memory.test.ts`; pinned `pnpm verify` passed on 2026-09-15 and published `evidence/implementation/manifest.json`.
