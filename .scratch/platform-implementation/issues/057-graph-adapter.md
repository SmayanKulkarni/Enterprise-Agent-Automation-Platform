# 057: Graph

**Source spec:** [Live Graph, SQL, Blob, Boards and Jira adapter specification, source slice 12.2](../../../docs/superpowers/specs/2026-09-14-12-live-provider-adapters-spec.md#ordered-implementation-slices)

**What to build:** Implement the least-privilege Microsoft Graph adapter for named demo users/groups, covering install/consent, constrained reads and membership writes, delta reconciliation, revoke and exact reset.

**Blocked by:** 056: Certification harness

**Status:** implementation-complete (live certification and root verification pending)

**Produces:** Certified Graph `ProviderAdapter` and installation readiness evidence

- [x] A ready Tenant installation reads only allocated objects, adds/removes only the marked demo membership and persists a Tenant/install/scope/schema/epoch-bound delta checkpoint.
- [x] Wrong Tenant/account/resource, scope drift, token expiry/revoke, forged push, duplicate or post-send timeout and inconclusive lookup cannot widen access or trigger unsafe retry.
- [ ] Publish dated live Graph certification with API/auth/scope versions, receipts/checkpoints, throttle/reconciliation results, consent/credential epochs, reset/removal inventory and secret scan.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `GraphAdapter` in `packages/providers/src/index.ts` and `tests/platform/provider-adapters.test.ts` constrain the installation/account/group/user set, preserve checkpoints, reconcile unknown outcomes and reset managed receipts. Dated Graph consent, API evidence and root verification require a real allocated Microsoft tenant.
