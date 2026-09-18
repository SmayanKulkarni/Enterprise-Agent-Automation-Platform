# 055: Close

**Source spec:** [Azure infrastructure, delivery, readiness and recovery specification, source slice 11.6](../../../docs/superpowers/specs/2026-09-14-11-azure-delivery-recovery-spec.md#ordered-implementation-slices)

**What to build:** Close the Azure environment by disabling admission, draining or preserving reconciliation work, exporting evidence and deleting only the exact lease-owned manifest while accounting for retained evidence and cost.

**Blocked by:** 054: Resilience

**Status:** fixture-verified; live Azure evidence pending

**Produces:** M9 live Azure deployment/restore/lease-teardown gate

- [x] Lease expiry or an authorized close command reconciles in-flight work, exports a complete evidence index and removes every inventoried owned resource with a clean residual/billable scan.
- [x] Ambiguous or out-of-manifest target, teardown cancellation/crash, held evidence and unavoidable retained cost stop or resume safely without deleting foreign resources or claiming zero cost.
- [ ] Publish M9 teardown command/receipts, exact resource inventory, evidence export, residual and billable-cost scans, lease timeline, held dispositions and secret scan. Live Azure evidence remains pending.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.
