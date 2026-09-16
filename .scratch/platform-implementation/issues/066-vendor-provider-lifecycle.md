# 066: Provider lifecycle

**Source spec:** [Vendor Risk and Access linked-Case specification, source slice 13.4](../../../docs/superpowers/specs/2026-09-14-13-vendor-risk-access-spec.md#ordered-implementation-slices)

**What to build:** Provision the approved grant through Graph and its Jira evidence workflow, then use the same durable command path for expiry, manual or policy revocation and unknown-outcome recovery.

**Blocked by:** 065: Linked grant

**Status:** fixture-boundary-complete (provider certification and root verification pending)

**Produces:** Vendor grant provision/revoke tracer bullet with `revocation-pending` recovery

- [ ] Graph membership and Jira evidence effects produce joined intents, receipts and checkpoints; expiry or explicit revoke reaches provider-confirmed revocation and closes the Case.
- [ ] Throttle/outage, duplicate/conflicting effect, post-send timeout, provider drift, crash/replay and failed or inconclusive revoke remain `revocation-pending` with Operator escalation, never false success.
- [ ] Publish Graph/Jira intent-to-checkpoint timelines, expiry/revoke receipts, unknown reconciliation, replay results, Operations/cost views and live-versus-fixture labels.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: the fixture lifecycle records Graph/Jira success independently, never promotes a partial result to `provisioned`, routes expiry through the same revoke method, and retains `revocation-pending` until both reconciliations confirm. Live intents/receipts/checkpoints remain owned by the existing provider adapters and require allocated installations.
