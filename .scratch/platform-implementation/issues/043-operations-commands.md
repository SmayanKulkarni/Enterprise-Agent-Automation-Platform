# 043: Commands

**Source spec:** [Operations information, observability and control plane specification, source slice 9.4](../../../docs/superpowers/specs/2026-09-14-09-operations-observability-spec.md#ordered-implementation-slices)

**What to build:** Register Operations operator/control commands on 004a's fixed browser command router, with 002a canonical decode and fresh owner authority/approval/version, while displaying owner commit separately from projection catch-up. Earlier Case/Lifecycle commands are wired by their owner slices; this ticket adds no generic dispatch or mutation ownership.

**Blocked by:** 042: Signals/cost

**Status:** complete

**Produces:** `submitOwnerCommand` transport interface without mutation ownership

- [x] An authorized Operator submits an exact command to the owning module, receives its durable receipt and observes independently updated projection status.
- [x] Route inventory lists each command name, exact owner and authority action; unknown names cannot dispatch. Identical key/digest retries return the stored owner receipt, conflicting key reuse fails, and possible-send timeout stays unknown until receipt/reconciliation.
- [x] Stale/concurrent/duplicate-conflicting clicks, missing approval, owner partial failure, projection delay and destructive commands without exact manifest deny or remain visibly pending.
- [x] Publish command/receipt/projection join timelines, authority and concurrency negatives, owner partial-failure fixtures, catch-up states and audit evidence.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.
