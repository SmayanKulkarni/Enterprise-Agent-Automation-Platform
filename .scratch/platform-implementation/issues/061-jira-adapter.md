# 061: Jira

**Source spec:** [Live Graph, SQL, Blob, Boards and Jira adapter specification, source slice 12.6](../../../docs/superpowers/specs/2026-09-14-12-live-provider-adapters-spec.md#ordered-implementation-slices)

**What to build:** Implement the Jira 3LO adapter for scoped vendor-evidence reads and marked access-review create, update and revoke actions, with atomic refresh, JQL reconciliation and exact reset.

**Blocked by:** 060: Boards

**Status:** implementation-complete (live certification and root verification pending)

**Produces:** Certified Jira `ProviderAdapter` and installation readiness evidence

- [x] A ready Tenant installation uses the approved site/project scopes, atomically refreshes credentials and reconciles marked issue effects through durable JQL checkpoints.
- [x] Wrong site/project/issue, scope drift, concurrent or failed refresh, revocation, schema/throttle error, duplicate/post-send timeout and inconclusive search cannot widen access or falsely report revoke.
- [ ] Publish dated live Jira certification with API/3LO/site/project versions, credential epochs, receipts/checkpoints, reconciliation/throttle results, reset inventory and secret scan.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `JiraAdapter` accepts only the configured site/project and exact marker-bound access-review writes; it shares safe throttle/unknown-outcome reconciliation and exact managed reset behavior. Live 3LO refresh and JQL certification need the allocated Jira Cloud site.
