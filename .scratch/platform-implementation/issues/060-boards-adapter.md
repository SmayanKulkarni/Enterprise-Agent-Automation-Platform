# 060: Boards

**Source spec:** [Live Graph, SQL, Blob, Boards and Jira adapter specification, source slice 12.5](../../../docs/superpowers/specs/2026-09-14-12-live-provider-adapters-spec.md#ordered-implementation-slices)

**What to build:** Implement the Azure Boards adapter for agreed project/item reads and marked implementation/defect create-update operations, using revision and WIQL reconciliation with exact reset.

**Blocked by:** 059: Blob

**Status:** implementation-complete (live certification and root verification pending)

**Produces:** Certified Boards `ProviderAdapter` and installation readiness evidence

- [x] A ready Tenant installation creates or updates only marked allocated work items and resolves the canonical receipt through project scope, effect marker and revision/WIQL checkpoint.
- [x] Wrong organization/project/item, permission or schema drift, revision conflict, throttle, duplicate/post-send timeout, callback loss and inconclusive lookup prevent unsafe retry or foreign mutation.
- [ ] Publish dated live Boards certification with auth/project/schema versions, receipts/revisions/checkpoints, throttle/reconciliation results, reset inventory and secret scan.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `BoardsAdapter` scopes reads/writes to its configured project, requires the exact demo marker for mutation, and retains scoped checkpoints and reset inventory. Live Azure DevOps/WIQL/revision evidence is still required.
