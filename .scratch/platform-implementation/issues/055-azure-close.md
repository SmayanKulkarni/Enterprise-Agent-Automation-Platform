# 055: Close

**Source spec:** [Azure infrastructure, delivery, readiness and recovery specification, source slice 11.6](../../../docs/superpowers/specs/2026-09-14-11-azure-delivery-recovery-spec.md#ordered-implementation-slices)

**What to build:** Close the Azure environment by disabling admission, draining or preserving reconciliation work, exporting evidence and deleting only the exact lease-owned manifest while accounting for retained evidence and cost.

**Blocked by:** 054: Resilience

**Status:** implementation-complete (root verification blocked by pinned Node mismatch)

**Produces:** M9 live Azure deployment/restore/lease-teardown gate

- [x] Lease expiry or an authorized close command reconciles in-flight work, exports a complete evidence index and removes every inventoried owned resource with a clean residual/billable scan.
- [x] Ambiguous or out-of-manifest target, teardown cancellation/crash, held evidence and unavoidable retained cost stop or resume safely without deleting foreign resources or claiming zero cost.
- [ ] Publish M9 teardown command/receipts, exact resource inventory, evidence export, residual and billable-cost scans, lease timeline, held dispositions and secret scan. Blocked: manifest publication runs only after pinned root verification.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest. Blocked: this shell has Node 24.13.0; the workspace requires Node 22.14.0.
