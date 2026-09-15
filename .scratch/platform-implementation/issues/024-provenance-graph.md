# 024: Provenance graph

**Source spec:** [Governed memory, provenance and Validated Experience specification, source slice 6.1](../../../docs/superpowers/specs/2026-09-14-06-memory-validated-experience-spec.md#ordered-implementation-slices)

**What to build:** Create immutable content-addressed source, derivative and status records as an acyclic provenance graph that carries scope, purpose, classification, legal basis, retention and every storage location.

**Blocked by:** 023: Lifecycle integration

**Status:** complete

**Produces:** Provenance graph interface underlying `memory.result-provenance`

- [x] Every eligible derivative traces to a current source/version/digest and records its transformation, model/prompt/config and complete storage-location lineage.
- [x] Cycles, orphan sources, digest conflicts, missing classification/scope and cross-Tenant parentage are rejected, while correction/deletion statuses immediately make affected nodes ineligible.
- [x] Publish graph invariant/property results, provenance traversal samples, canonical digests, Tenant-substitution negatives and classification/secret scan.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `tests/platform/lifecycle-memory.test.ts`; pinned `pnpm verify` passed on 2026-09-15 and published `evidence/implementation/manifest.json`.
