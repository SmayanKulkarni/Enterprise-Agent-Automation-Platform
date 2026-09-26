# Complete the authenticated Studio frontend for Operational Memory

**Status:** ready-for-agent
**Triage:** ready-for-agent
**Extends:** Agentic Operational Memory integration for Diagram Workflow V1

## Problem Statement

The authenticated Solution Studio can publish a Workflow Definition with a Memory node and show basic Operational Memory metadata, but an editor still has to edit raw JSON to set retrieval bounds or enable Agent-authored proposals. Operators cannot see complete retrieval provenance or useful provider-readiness guidance. Tenant administrators cannot set item expiry from the interface, and incomplete lifecycle metadata makes promotion and removal failures difficult to understand. These gaps keep the already implemented runtime and browser contracts from being usable end to end, while the browser must continue to withhold stored memory text, embeddings, provider credentials, and protected Run History input.

## Solution

Finish the existing Studio journey. Give editors typed Memory node controls and a guided Agent proposal schema control. Show operators the full redacted item and retrieval projections, with clear readiness and recovery states. Give tenant administrators an expiry action alongside the existing Memory Import and lifecycle actions. Reuse the current graph draft, authenticated browser API, commands, projections, and panels; keep promotion, retrieval, access control, and retries on the server.

## User Stories

1. As a workflow editor, I want to set the Memory node item limit through a labeled number control, so that I can bound the number of recalled items.
2. As a workflow editor, I want to set the Memory node character budget through a labeled number control, so that recalled evidence fits the published prompt budget.
3. As a workflow editor, I want invalid or empty Memory node bounds identified before saving, so that I do not publish an unusable revision.
4. As a workflow editor, I want to see the Memory node policy in the inspector, so that I understand the fixed execution bounds of that node.
5. As a workflow editor, I want existing Memory node settings preserved when I change one bound, so that a focused edit does not erase its policy.
6. As a workflow editor, I want my Memory node changes to clear the current publishable check, so that publication uses a newly checked draft.
7. As a workflow editor, I want to opt an Agent into proposing Operational Memory through its response schema, so that the Agent can return candidates for server validation.
8. As a workflow editor, I want to remove proposal support from that schema without losing unrelated output fields, so that I can turn the feature off for one Agent.
9. As a workflow editor, I want the Agent inspector to explain the two admitted proposal types, so that I ask only for task facts or explicitly stated user preferences.
10. As a workflow editor, I want the Agent inspector to show the required source reference, digest, excerpt, text, and preference subject fields, so that I can write a valid response instruction.
11. As a workflow editor, I want to see that an Agent may return at most three proposals, so that I do not design a response the runtime will discard.
12. As a workflow editor, I want to see that sources must match immutable evidence from the same Workflow Run, so that I do not imply that an Agent can invent source IDs or digests.
13. As a workflow editor, I want to see that proposals cannot carry instructions, secrets, or inferred user traits, so that my prompt guidance respects the memory boundary.
14. As a workflow editor, I want a proposal shape that coexists with existing Agent result fields, so that enabling memory does not break downstream mappings.
15. As a workflow editor, I want a check of the published Agent response schema, so that a malformed schema blocks publication through the existing validation path.
16. As a workflow operator, I want to see whether Operational Memory is disabled, not configured, ready, or unavailable, so that I can distinguish no recalled items from a provider problem.
17. As a workflow operator, I want readiness text to identify the appropriate tenant administrator or deployment operator action, so that I know where recovery belongs.
18. As a workflow operator, I want an unavailable provider state to explain that Workflow Runs continue without recalled context, so that I can interpret the run outcome correctly.
19. As a workflow operator, I want to see item type, lifecycle state, source ID and digest, and producing revision, so that I can identify the evidence behind an item.
20. As a workflow operator, I want to see whether an item is definition-scoped or owner-scoped without seeing the owner's identity, so that I can understand its retrieval boundary.
21. As a workflow operator, I want to see an item's predecessor, promotion time, expiry, hold, and vector state when available, so that I can follow correction and removal progress.
22. As a workflow operator, I want to see a safe failure reason for a rejected or failed item, so that I can distinguish invalid evidence from a provider failure.
23. As a workflow operator, I want to see retrieval status, node ID, item IDs, import IDs, and a safe failure state on each Workflow Run, so that I can explain what the Memory node used.
24. As a workflow operator, I want empty and unavailable retrieval receipts shown explicitly, so that neither state looks like a missing history record.
25. As a workflow operator, I want to see that pending and failed promotions are not retrievable, so that I do not expect an item to appear in a later run before promotion succeeds.
26. As a workflow operator, I want to see that removal is pending or complete, so that I can understand the effect of withdrawal or deletion without a manual retry button.
27. As a tenant administrator, I want to set an item's expiry using its current version, so that I can shorten its future retrieval lifetime.
28. As a tenant administrator, I want the expiry control to show the current value and reject an invalid or later value before submission, so that I avoid an accidental extension.
29. As a tenant administrator, I want confirmation of the expiry change or a clear stale-version error, so that I know whether to refresh and try again.
30. As a tenant administrator, I want to keep the existing withdraw, hold, release, delete, invalidate, and correction actions, so that the full lifecycle stays available in one place.
31. As a tenant administrator, I want to see the source Workflow Definition and exact target revision of each Memory Import, so that I can inspect its scope.
32. As a tenant administrator, I want import revocation described as prospective, so that I understand that earlier Run History remains unchanged.
33. As a tenant member without administrator authority, I want lifecycle and Memory Import mutation controls withheld, so that Studio reflects my permissions.
34. As a tenant member, I want memory projections cleared when I switch tenants or sign out, so that another tenant's metadata does not remain visible.
35. As a tenant member, I want no stored memory text, embeddings, protected run input, or credentials in the Studio response or view, so that the browser boundary stays intact.
36. As a tenant administrator, I want a correction to submit only the text I enter and then clear the field, so that prior stored memory text is never fetched into the browser.
37. As a workflow editor, I want the controls to work with keyboard and assistive technology, so that I can configure and inspect memory without relying on pointer gestures.
38. As a workflow operator, I want loading, empty, and request-failure states for each memory view, so that I can tell whether a projection was loaded.

## Implementation Decisions

- Keep the authenticated Solution Studio as the only frontend surface. Reuse its selected-node inspector, graph draft state, publish check, Memory Import panel, Operational Memory panel, and existing `PlatformApi` transport. The generic fixture Memory route remains separate.
- For a Memory node, replace its JSON-only settings editor with integer inputs for `limit` from 1 through 20 and `maxChars` from 1 through 4000. Preserve all other configuration fields while changing either value. Show the existing required Node policy as read-only explanatory content; the published graph validator remains authoritative. Reject empty, fractional, out-of-range, and non-finite values before updating draft state rather than silently coercing them.
- For an Agent node, use the existing `responseSchema` field as the proposal enablement mechanism. Enabling adds an optional top-level `memoryProposals` property of type `array`; disabling removes only that property and removes it from `required` if present. Preserve the rest of the response schema and Agent configuration. Do not introduce a runtime feature flag or direct browser write command.
- Provide copyable guidance for each proposal: `type` is `task-fact` or `stated-preference`; `text`, `sourceId`, `sourceDigest`, and `excerpt` are required; `subject` is required for a stated preference; `predecessorId` is optional. Text and excerpt are each at most 1000 characters, subject at most 200, and a result may carry at most three proposals. Exact source IDs and digests must come from the current run's validated input or completed event evidence. This guidance is descriptive; the current top-level response-schema validator cannot express nested array item rules, so server proposal validation remains decisive.
- Make proposal controls explain that the server derives tenant, stable Workflow Definition, and owner scope; it redacts and checks the cited evidence; invalid proposals stay non-retrievable. Do not teach users to put raw protected Run History input into the UI.
- Keep Memory Imports tied to a source stable Workflow Definition and an exact target published revision. The existing admin-only attach and revoke commands, including expected versions and idempotency, remain in use. Clarify in copy that revocation affects future retrieval only.
- Render every non-content field already present in the memory-item projection: type, state, source ID and digest, producing revision, owner scope flag, predecessor, promotion time, expiry, hold, failure, and vector state. Use explicit absent-value labels where the field is optional. Never request vector text or owner identity for this view.
- Render each retrieval receipt from the Workflow Run projection with run ID, Memory node ID, status, item IDs, import IDs, and optional failure. Scope displayed receipts to the selected published definition or stable Workflow Definition as appropriate; do not mix unrelated Workflow Runs in a definition view.
- Add the existing `set-memory-expiry` command to the administrator's item actions, sending the item ID, ISO timestamp, and current item version. Use a native date/time input, convert local time to an ISO instant, and permit only a valid shortening of the shown expiry within the server's maximum horizon. Refresh the item projection after success; preserve the server's validation and authorization as the final authority.
- Keep correction input user-entered and transient. Its entered text goes to the existing administrator command, but stored memory content never comes back from a projection. Clear it after a successful command and on tenant change.
- Map readiness states to concise operational guidance: disabled means tenant enablement is pending; not configured means deployment integration and credentials need an operator; ready means hosted retrieval is available; unavailable means the provider needs operator attention while runs continue. Show no environment values, connection strings, or provider secrets.
- Show pending or exhausted promotion and removal through existing lifecycle and vector states. Durable runtime retries are automatic and bounded; no manual promotion/removal retry command or button is added. Only display failure details that are safe for the browser. If the current failure projection can contain an arbitrary provider exception, normalize it to a safe category at the projection boundary before rendering.
- Keep the existing tenant-scoped projections and administrator command authorization. The UI hides or disables actions according to the authenticated profile, but the server remains responsible for tenant, owner, role, expected-version, and scope checks. Abort or ignore stale responses when the tenant, definition, or session changes.
- Use existing Studio field, panel, notice, and status styles, with visible labels, keyboard focus, and accessible feedback. Do not add a dependency, route, provider configuration form, schema editor, or new backend memory write path.

## Testing Decisions

- Test observable user behavior and browser command/projection boundaries, not component state or internal helper calls. The primary accepted seam is the authenticated browser journey through a published Workflow Run to redacted Studio projections, already confirmed in the parent integration spec. Keep focused browser checks where that seam cannot exercise a control efficiently.
- Extend the existing Studio graph and browser API tests to verify that typed Memory inputs preserve Node policy, reject invalid bounds, and serialize the expected draft; Agent proposal enablement adds or removes only the top-level schema property while preserving downstream result fields.
- Exercise the Operational Memory and Memory Import panels with representative projections to verify complete redacted metadata, retrieval provenance, role gating, readiness copy, tenant/definition switching, and empty and failure states. Assert that stored text, embeddings, protected input, and provider credentials never render.
- Verify the expiry command through the existing browser command seam: ISO timestamp, item ID, current expected version, success refresh, and stale or denied feedback. Include a held item and a later-than-current expiry as negative cases where the UI or server contract requires them.
- Extend the existing workflow end-to-end test only for the highest-value cross-boundary path: published graph with Agent proposals and a Memory node, browser-visible promotion or failure status, retrieval receipts, and a subsequent expiry or lifecycle action. Reuse existing provider test doubles; the hosted-vector adapter's real-service certification remains covered by its existing separate gate.
- Prior art is the current workflow end-to-end browser journey, browser contract and `PlatformApi` tests, and Studio graph-model tests. Add one focused UI interaction seam if the existing tests cannot observe controls; avoid a suite per component or duplicated server lifecycle tests.

## Out of Scope

- Reworking the runtime, graph compiler, Azure Durable Functions, vector adapter, Run History storage, browser transport, or Memory Import authority model.
- A browser path to write, retrieve, search, export, or preview raw Operational Memory text; a manual promotion or removal retry command; provider credential or tenant-enable controls.
- Cross-tenant imports, implicit Agent retrieval, inferred user traits, historical backfill, new memory item types, or a general JSON Schema builder.
- Replacing the existing lifecycle controls or changing the meaning of legal hold, correction, withdrawal, source invalidation, or prospective import revocation.

## Further Notes

- This issue implements the remaining Studio work described by the agentic-memory integration spec and handoff. The accepted Q38 and Q39 decisions and the existing integration, lifecycle, and rollout issues remain the source of truth for runtime semantics.
- The local Markdown issue directory is the project tracker. `ready-for-agent` is its triage status, not a GitHub label.
- The parent spec already records the user's acceptance of the authenticated browser-to-redacted-projection test seam. This issue reuses it rather than introducing another seam.
