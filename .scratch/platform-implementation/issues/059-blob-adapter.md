# 059: Blob

**Source spec:** [Live Graph, SQL, Blob, Boards and Jira adapter specification, source slice 12.4](../../../docs/superpowers/specs/2026-09-14-12-live-provider-adapters-spec.md#ordered-implementation-slices)

**What to build:** Implement the Blob adapter for manifest-scoped reads and conditional validation/handoff writes, with identity, path confinement, ETag reconciliation, change checkpoints and exact reset.

**Blocked by:** 058: SQL

**Status:** implementation-complete (live certification and root verification pending)

**Produces:** Certified Blob `ProviderAdapter` and installation readiness evidence

- [x] A ready Tenant installation reads only declared source manifests and conditionally writes marked artifacts whose digest, ETag and receipt reconcile to the effect intent.
- [x] Path traversal, foreign container/object, stale ETag conflict, schema drift, duplicate/post-send timeout, missed event and inconclusive lookup cannot overwrite or falsely confirm an artifact.
- [ ] Publish dated live Blob certification with identity/path/schema versions, ETag/reconcile receipts, checkpoints, throttle/failure results, reset inventory and secret scan.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `BlobAdapter` confines reads to the source manifest and writes to a configured prefix with a required ETag; traversal/foreign paths are rejected before the transport. The live Storage conditional-write and change-feed certification needs an allocated Azure Storage account.
