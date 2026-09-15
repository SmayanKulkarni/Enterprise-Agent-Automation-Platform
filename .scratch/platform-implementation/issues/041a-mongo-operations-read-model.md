# 041a: Mongo Operations read model

**Source:** [Operations projection](../../../docs/superpowers/specs/2026-09-14-09-operations-observability-spec.md), [Tenant isolation](../../../docs/architecture/tenant-isolation-ownership.md), [Wayfinder persistence decision](../../frontend-mvp-integration/issues/02-mongo-ownership-and-evidence.md)

**What to build:** Satisfy the MongoDB part of MERN as a disposable Operations projection adapter behind the existing Tenant-scoped query interface; owner facts, immutable audit and owner commands remain in their owning modules.

**Blocked by:** 041: Projection, 039a: Studio and Catalog views; Wayfinder persistence decision (resolved)
**Status:** complete
**Produces:** rebuildable Mongo Operations projection adapter

- [x] Store only 040's validated, transformed, classified-safe projection snapshots/checkpoints. Collections, query/update filters and compound indexes start with authenticated `tenantId`; event dedupe uses producer/event ID and owner sequence, with deterministic replay, bounded gap handling, watermark/completeness and version quarantine. No frontend or Express handler writes owner facts to Mongo.
- [x] `GET .../operations` reads the same authorized projection contract from Mongo or the existing adapter without response drift. Exact Tenant deletion/restore manifests include projection partitions; rebuild from owner events proves no second source of truth.
- [x] Verify two-Tenant query/index substitution, duplicate/reordered/gapped events, exact-manifest purge, projection loss/rebuild byte-equivalence, cursor Tenant substitution and classified redaction; root verification passes. Mongo fixture, SQL/Azure and live evidence gates stay separately labeled.
