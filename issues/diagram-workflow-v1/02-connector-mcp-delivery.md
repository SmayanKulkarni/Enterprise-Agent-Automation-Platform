# 02: Connector Installation and MCP delivery

**Status:** ready-for-agent
**Source spec:** [V1 integration](00-spec.md)
**Blocked by:** 01

## What to build

Make certified Connector Installations callable through the existing Capability Gateway contracts. Add durable installation, manifest, credential-reference, effect-intent, attempt, receipt, and reconciliation records where the current in-memory Gateway cannot survive restart. Use HTTPS for public Extensions and a tenant-operated private connector agent that polls outbound over HTTPS. Bind the agent to one installation with a revocable bearer token shown once and stored only as a hash.

## Acceptance

- [ ] Tenant admins can certify a Capability Manifest, make a named Capability available for an explicit workflow grant, enroll an installation agent, and manually rotate or revoke its token.
- [ ] Admission intersects tenant authority, published grant, manifest version, installation health, credential scope, risk tier, schema, budget, and exact Approval.
- [ ] The server persists dispatch intent before possible delivery. Duplicate poll/result/activity delivery cannot repeat a confirmed effect.
- [ ] A lost reply after possible delivery becomes unknown outcome and requires admin reconciliation; it is never automatically redelivered.
- [ ] An offline agent waits durably to the node deadline; retry is limited to proven pre-effect failures and published circuit rules.
- [ ] A tenant cannot poll, return, inspect, or reconcile another tenant's installation or effect.
- [ ] The authenticated browser API and injected MCP boundary verify receipts, unknown outcomes, revocation, and tenant isolation.
