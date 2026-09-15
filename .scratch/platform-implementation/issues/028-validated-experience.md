# 028: Experience

**Source spec:** [Governed memory, provenance and Validated Experience specification, source slice 6.5](../../../docs/superpowers/specs/2026-09-14-06-memory-validated-experience-spec.md#ordered-implementation-slices)

**What to build:** Turn provenance-bearing candidates into reviewed, immutable Validated Experience versions with conflict, expiry, supersession, withdrawal and explicitly reviewed scope derivation.

**Blocked by:** 027: Lifecycle

**Status:** implementation-complete-pending-pinned-verification

**Produces:** M5a scoped-memory gate and `memory.validated-experience` interface

- [x] An independent reviewer can approve an evidence-ready candidate into an eligible immutable version whose scope and provenance remain attributable through later status changes.
- [x] Author/reviewer conflict, duplicate or contradictory evidence, stale source/index, unreviewed scope widening and Tenant-to-platform promotion are rejected or retained as visible conflict.
- [x] Publish M5a candidate/review/promotion fixtures, immutable status timeline, conflict and scope-widening tests, provenance/access reports and secret scan.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `tests/platform/memory-evaluation.test.ts`; lint, static typecheck and all 23 tests passed on 2026-09-15. Pinned verification remains blocked by Node 22.14.0 being unavailable.
