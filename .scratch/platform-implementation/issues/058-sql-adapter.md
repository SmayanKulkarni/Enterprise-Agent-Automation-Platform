# 058: SQL

**Source spec:** [Live Graph, SQL, Blob, Boards and Jira adapter specification, source slice 12.3](../../../docs/superpowers/specs/2026-09-14-12-live-provider-adapters-spec.md#ordered-implementation-slices)

**What to build:** Implement the Azure SQL adapter for allowlisted schema reads/aggregates and parameterized idempotent upserts, with identity, transactions, polling or CDC checkpoints and exact reset.

**Blocked by:** 057: Graph

**Status:** implementation-complete (live certification and root verification pending)

**Produces:** Certified SQL `ProviderAdapter` and installation readiness evidence

- [x] A ready Tenant installation performs only declared parameterized operations, returns canonical receipts and advances a durable scoped polling/CDC checkpoint after committed data.
- [x] Schema drift, injection or unallocated table, concurrent transaction conflict, pre/post-send timeout, local crash after commit and absent idempotency require safe lookup/reconcile before retry.
- [ ] Publish dated live SQL certification with identity/schema versions, transaction/idempotency results, receipts/checkpoints, throttling, reset inventory and secret scan.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `SqlAdapter` admits only declared table names and identifier-shaped named parameters, leaves SQL text to the parameterizing transport, and shares safe reconciliation/reset behavior covered by `tests/platform/provider-adapters.test.ts`. Live Entra/SQL transaction certification remains external.
