# 03: Compile and publish a Workflow Definition

**Status:** ready-for-agent
**Source spec:** [V1 integration](00-spec.md)
**Blocked by:** 01, 02

## What to build

Validate a saved graph and compile it into an immutable, digest-addressed Workflow Definition. Support only Trigger, Memory, Agent, Condition, Approval, MCP, and End nodes on one path at a time. Bind Node policy, model policy, certified Capability Manifest versions, and explicit Capability grants at publication. Let editors save/check; require a tenant admin and current checks for publication. Keep the current joined, unsupported sample as a clearly labeled fixture or replace it with a valid sequential sample.

## Acceptance

- [ ] Publication rejects unknown node kinds, duplicate/dangling/unreachable nodes, cycles, joins, parallel fan-out, missing End, invalid Condition exits, schema mismatches, missing grants, uncertified or changed manifests, and unbounded policy.
- [ ] The compiled definition contains executable node configuration and explicit successor rules, with no credentials, secret values, or authority taken from canvas labels/coordinates.
- [ ] The tenant admin reviews the exact candidate digest, risk tiers, model policy, and evidence before publishing; an editor or operator is denied by server authority.
- [ ] Publishing a changed draft creates a new immutable revision; existing published revisions remain addressable and unchanged.
- [ ] Fixture checks cannot satisfy a live release gate. The existing Studio lifecycle and evaluation behavior remain available for other package shapes.
- [ ] The confirmed authenticated browser API seam checks publication and denial from observable receipts and read projections.
