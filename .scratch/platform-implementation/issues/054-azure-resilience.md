# 054: Resilience

**Source spec:** [Azure infrastructure, delivery, readiness and recovery specification, source slice 11.5](../../../docs/superpowers/specs/2026-09-14-11-azure-delivery-recovery-spec.md#ordered-implementation-slices)

**What to build:** Inject worker, queue, data, telemetry, deployment and migration failures, then exercise checkpointed replay, quarantine restore and the separate app/config/data/package/provider recovery dimensions.

**Blocked by:** 053: Delivery/readiness

**Status:** implementation-complete (root verification blocked by pinned Node mismatch)

**Produces:** Azure failure-injection and quarantine-restore evidence

- [x] Declared failures recover without duplicate effects or cross-Tenant state, and a verified quarantine restore meets measured RPO and RTO before an authorized merge or switch.
- [x] Poison/backpressure, SQL/Blob loss, restore crash, foreign backup, stale authority and rollback-vector mismatch remain partial or quarantined and never claim active recovery.
- [ ] Publish fault matrix, replay/reconcile timelines, restore manifest and causality checks, measured RPO/RTO, rollback-vector dispositions, alerts and audit evidence. Blocked: manifest publication runs only after pinned root verification.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest. Blocked: this shell has Node 24.13.0; the workspace requires Node 22.14.0.
