# 04: Durable Workflow Runs

**Status:** ready-for-agent
**Source spec:** [V1 integration](00-spec.md)
**Blocked by:** 02, 03

## What to build

Start one Workflow Run from a published revision and validated input, by authenticated manual command or signed, replay-protected webhook Trigger. Use a generic Azure Durable Functions orchestration to interpret the pinned graph sequentially. Keep graph traversal, Condition choice, timers, and approval waits deterministic; perform all model, Memory, MCP, and database I/O in activities. Persist ordered Run History apart from Studio test evidence. Reuse Case/Intervention and Gateway contracts where their semantics fit, without treating their in-memory adapters as durable storage.

## Acceptance

- [ ] A run pins tenant, Workflow Definition revision/digest, input snapshot/digest, and idempotent start identity.
- [ ] A valid run follows one explicit path and reaches End; an invalid node result stops safely.
- [ ] Approval binds one exact effect to revision, Capability, target, and arguments digest; rejection or expiry prevents invocation.
- [ ] Worker restart and activity redelivery preserve node order and do not repeat confirmed effects.
- [ ] A failed node stops the run and preserves prior evidence; uncertain effects require reconciliation before any repeat decision.
- [ ] Run History contains ordered node attempts, model metadata, approval decisions, dispatch intents, receipts, and final status in tenant-keyed durable storage.
- [ ] Webhook signature, tenant binding, freshness, and replay protection are enforced before a run is created.
- [ ] The confirmed browser API seam verifies start, approval, recovery, failure, receipts, and redacted read projections.
