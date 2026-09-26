# 01: Authenticated graph drafts

**Status:** ready-for-agent
**Source spec:** [V1 integration](00-spec.md)
**Blocked by:** none

## What to build

Connect the existing Solution Studio graph editor to the registered, tenant-scoped Studio draft commands and SQL revision store. Save and reload nodes, edges, node settings, and layout as one graph draft. Preserve existing agent-team/package drafts as their own shape. Resolve tenant selection from the authenticated Clerk session; persist server-side membership profiles and enforce editor/admin authority there. The browser role preview, email shortcut, local revision counter, and hardcoded controls cannot authorize or claim a live save.

## Acceptance

- [ ] An authenticated editor creates, saves, reloads, and revises a graph through the existing browser command envelope and Studio store.
- [ ] A stale expected revision conflicts; idempotent retries return the same result without another revision.
- [ ] Tenant switch, sign-out, revoked membership, and changed membership epoch prevent cross-tenant draft reads or writes.
- [ ] The saved graph retains all authoring fields; secrets and credentials are rejected at the browser/server trust boundary.
- [ ] Existing package/agent-team Studio behavior and fixture mode still work, with fixtures clearly labeled and unable to claim a live save.
- [ ] The authenticated browser transport seam verifies these outcomes, extending existing Clerk, Studio command/store, and browser contract tests.
