# 048: Negatives/recovery

**Source spec:** [Local Technical Implementation vertical-slice specification, source slice 10.4](../../../docs/superpowers/specs/2026-09-14-10-local-technical-implementation-spec.md#ordered-implementation-slices)

**What to build:** Exercise the reference Case through cross-Tenant denial, stale/self approval, budget and throttle limits, duplicates/conflicts, possible-send timeout reconciliation and workflow restart.

**Blocked by:** 047: Success path

**Status:** complete

**Produces:** Local denial/failure/recovery tracer bullet with labeled evidence

- [x] Every injected failure reaches its declared denial, wait, reconcile, pause/recover or terminal state and the Case resumes only after current dependencies and evidence validate.
- [x] Unknown provider write is never retried before conclusive lookup, conflicting idempotency never reuses a receipt, and crash/replay never repeats model or external work.
- [x] Publish simulated-failure manifests, denial matrix, reconcile/checkpoint timeline, replay digests/activity counts, residual risk and Operations alert/runbook records.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.
