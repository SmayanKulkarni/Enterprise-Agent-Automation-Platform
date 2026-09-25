# 04: Configure a granted MCP Capability

**What to build:** An editor chooses a certified Connector Installation and Capability, maps supported Trigger or Agent fields into its arguments, and an administrator grants that Capability to the MCP node.

Populate installation and Capability choices from tenant-scoped connector and grant projections. Show certification, health, risk, required input fields, and whether a grant exists. The inspector configures the current target and bounded Node policy with controls. For each Capability argument, let the editor enter a typed constant or choose a field from Trigger input or a preceding Agent output; persist the current mapping expression and existing graph fields without exposing the syntax as a required authoring step. A certified Canva installation is example data, not a built-in provider.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] The inspector offers tenant-scoped certified choices instead of requiring opaque installation and Capability identifiers.
- [x] Argument controls support constants and existing input or prior-node references, preserve current graph-v1 fields, and explain incompatible mappings before publication.
- [x] An administrator can grant the selected Capability to the specific node; other roles cannot.
- [x] Server check and dispatch still enforce certification, manifest pin, grant, risk, and Approval requirements.
- [x] Mapping choices include only supported, type-compatible fields from prior nodes; missing required arguments and stale or unavailable grants identify the specific control to correct.
- [x] Changing the selected Capability refreshes the argument form from its certified input schema without silently reusing incompatible values.
- [x] An editor can save and reload the configured node, an administrator can grant it, and server check then accepts the same graph without manual identifier or JSON entry.
- [x] Browser command and workflow coverage confirm role boundaries and that one approved Run sends the resolved arguments through the existing Capability Gateway.

Verified with `pnpm typecheck` and focused Vitest coverage for graph mapping, workflow graph validation, and browser contracts.
