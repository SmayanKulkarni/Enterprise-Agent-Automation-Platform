# 027: Lifecycle

**Source spec:** [Governed memory, provenance and Validated Experience specification, source slice 6.4](../../../docs/superpowers/specs/2026-09-14-06-memory-validated-experience-spec.md#ordered-implementation-slices)

**What to build:** Implement correction, exact-manifest deletion, legal hold, retention/export and quarantine restore across records, derivatives, indexes, caches, datasets, experiences, exports and backups.

**Blocked by:** 026: Retrieval

**Status:** implementation-complete-pending-pinned-verification

**Produces:** Memory correction/deletion/hold/restore lifecycle interfaces

- [x] Correction appends a source version and traverses descendants; deletion records a terminal disposition for every manifest item; restore remains quarantined until current policies are applied and residue is absent.
- [x] Concurrent correction/delete/hold, crash/resume, partial purge, false completion, backup reintroduction and ambiguous destructive scope stop completion while preserving held audit evidence.
- [x] Publish lifecycle transition coverage, traversal/disposition reports, exact manifests, crash/resume and restore-quarantine results, residual and classification scans.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `tests/platform/memory-evaluation.test.ts`; lint, static typecheck and all 23 tests passed on 2026-09-15. Pinned `pnpm verify` is blocked because only Node 24.13.0 is installed (repository requires 22.14.0).
