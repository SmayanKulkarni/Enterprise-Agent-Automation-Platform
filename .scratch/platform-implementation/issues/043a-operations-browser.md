# 043a: Operations browser and error states

**Source:** [Operations commands](../../../docs/contracts/operations-control-plane-commands.md), [Operations specification](../../../docs/superpowers/specs/2026-09-14-09-operations-observability-spec.md)

**What to build:** Reuse the Case workbench in Operations overview, evidence timeline, provider/deployment health, alert/runbook and cost views; add route-level error pages for every browser surface.

**Blocked by:** 043: Commands, 039a: Studio and Catalog views
**Status:** complete
**Produces:** browser operations/control and safe failure path before 044 UI gate

- [x] `GET .../operations` and `GET .../deployments` show Tenant/environment/time, watermark, completeness, estimated/final/unknown cost, audit/evidence classification, alert state and canonical runbook links. Search/detail follows authorized opaque IDs.
- [x] Consume 041's safe encoded query DTO from either adapter and 004a's authorized fetch-SSE/GET-poll refresh; do not treat an event as a receipt or a partial Mongo projection as complete owner state.
- [x] Pause/resume/cancel/retry/reconcile/compensate, capability/package, Tenant export/hold/suspend/recover/delete, and deploy/restore/teardown actions route to their owning `POST .../commands/:owner/:name` after server preview, fresh authority, exact scope/manifest and approval. Operations owns transport and projections only.
- [x] Add signed-out, forbidden/non-enumerating not-found, validation, conflict/stale, dependency unavailable, timeout/unknown-outcome, partial projection, schema-incompatible and generic crash pages; each has a safe retry/refresh or return path and no token/secret detail.
- [x] Verify keyboard/screen-reader basics, cross-Tenant evidence, owner commit versus lagging projection, alert links and one error for each class; root verification passes.
