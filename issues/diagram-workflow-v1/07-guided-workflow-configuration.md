# 07: Guided configuration for executable workflow nodes

**Status:** ready-for-agent
**Triage:** ready-for-agent
**Source spec:** Diagram Workflow V1 and the database-update-to-Canva-deck example
**Depends on:** The existing published Definition, Workflow Run, Connector Installation, Capability Grant, and browser command/projection contracts

## Problem Statement

A tenant editor can draw a Trigger, Condition, Approval, and MCP node, but the live inspector exposes most settings as raw JSON. The canvas also offers Skill, Retriever, HTTP, and Send webhook blocks that cannot publish as executable V1 nodes. A database update cannot be connected from the browser: the signed inbound webhook exists, but its URL, secret provisioning, event contract, and test flow are absent from Studio. The manual Start button sends an empty object, so it cannot test a required input schema. Condition exits are visually ambiguous, Approval shows only a digest, and MCP configuration requires internal IDs and mapping syntax. A user cannot confidently build or review the database-update-to-Canva-deck workflow from the live UI.

## Solution

Make the live Studio a guided authoring and operating surface for every executable V1 node except Agent, whose separate implementation is underway. The primary example is: a database change sender posts a signed event; the webhook Trigger validates it; a Condition routes records with status `ready`; an Agent prepares slide content; an administrator approves the exact deck-creation effect; a granted Canva MCP capability creates the deck; the run ends. A false Condition path ends without a deck. The inbound webhook is configured on the Trigger, not via a Send webhook node.

Editors can configure nodes with typed controls, preview a redacted event and mappings, save and check a draft, and see errors at the relevant field or edge. Administrators can provision and test webhook delivery, certify and grant connector capabilities, review an intelligible Approval, and publish. Operators can manually start a published manual-mode Definition using schema-valid input and inspect each Run. Preserve current runtime semantics, authorization checks, and existing draft data.

## User Stories

1. As an editor, I want the live node library to identify which blocks are executable, so that I cannot mistake a decorative block for a publishable step.
2. As an editor, I want to see one Trigger at the start of the graph, so that I understand how a run begins.
3. As an editor, I want to choose manual or signed webhook mode, so that the Trigger matches my event source.
4. As an editor, I want to define required input fields and types, so that an external event has a clear contract.
5. As an editor, I want to inspect a sample event against that contract, so that I can correct it before publication.
6. As an administrator, I want a published webhook URL and signing instructions, so that I can configure my database's event sender.
7. As an administrator, I want to create and rotate a webhook signing secret without revealing it after creation, so that external delivery remains controlled.
8. As an administrator, I want to send a signed test event and see its Run ID and result, so that I can verify the connection.
9. As an operator, I want to see whether an event was rejected for shape, signature, freshness, or replay, so that I can diagnose delivery without seeing secret data.
10. As an editor, I want the Condition inspector to select a prior input or Agent output field and a typed comparison value, so that I can route a run without writing JSON.
11. As an editor, I want clearly labeled true and false ports, so that I connect each path deliberately.
12. As an editor, I want each Condition path to reach an End node, so that skipped records complete cleanly.
13. As an editor, I want to configure an Approval timeout and the adjacent MCP action, so that the checkpoint protects the intended effect.
14. As an administrator, I want to see the exact target, capability, and redacted argument summary before approval, so that I know what I authorize.
15. As an administrator, I want to approve or reject a waiting Run and see the resulting status, so that the decision is auditable.
16. As an editor, I want to select a certified Connector Installation and Capability from available choices, so that I do not enter opaque IDs manually.
17. As an administrator, I want to grant a Capability to a specific MCP node, so that the action has explicit authority.
18. As an editor, I want to map typed Trigger or Agent fields to MCP arguments, so that the Canva request uses the current event's content.
19. As an editor, I want incompatible or unavailable mappings explained before publication, so that I can correct them.
20. As an operator, I want a form for valid manual Trigger input, so that I can test a manual-mode Definition with required fields.
21. As an operator, I want webhook-mode Definitions to show a webhook test path instead of an unusable manual Start action, so that the UI reflects how they run.
22. As an editor, I want Memory and End nodes to have focused settings and clear descriptions, so that all executable non-Agent nodes are understandable.
23. As an editor, I want unsupported Skill, Retriever, HTTP, and Send webhook blocks hidden or explicitly marked preview-only in the live library, so that I do not publish an invalid graph unknowingly.
24. As an editor, I want old saved drafts to remain readable and editable, so that the new forms do not invalidate existing work.
25. As an administrator, I want a disabled or unconfigured webhook to fail closed, so that publication never silently creates an open ingress.
26. As an operator, I want Run History, waiting state, receipts, and reconciliation shown together, so that I can follow the deck from event to outcome.
27. As a tenant member, I want all workflow data scoped to my tenant and role, so that I cannot inspect another tenant's event, secret, or effect.

## Implementation Decisions

- The live library offers only the V1 executable kinds: Trigger, Memory, Agent, Condition, Approval, MCP, and End. Existing unsupported draft nodes remain loadable and visibly invalid until replaced; do not silently rewrite them. Keep the fixture preview separate from the live library.
- Replace the live raw JSON Step settings editor for non-Agent nodes with typed panels that read and write the existing graph-v1 node `config` shape. Preserve an existing valid configuration on load. Derive controls from published graph and Capability schemas rather than duplicating runtime validators. Agent settings remain owned by the ongoing Agent work.
- Keep the graph compiler and server-side check authoritative. The browser can prevalidate for feedback, but save/check/publish still use the existing revision and digest flow. Do not change the compiled graph format, execution ordering, or Condition equality semantics in this issue.
- Show two explicit Condition exits with true/false labels. Store the same branch values on graph edges. Prevent duplicate edges in the editor and surface missing, conflicting, or type-incompatible paths from server validation beside the relevant port. Retain existing single-path execution, with no joins or loops.
- Treat the Trigger's `webhook` mode as inbound. Configure its input schema in Studio and show the published URL after publication. Do not use the library's Send webhook block for intake. Document that the user's database or event relay must send the event; the platform does not subscribe directly to database changes.
- Add an admin-only, tenant-scoped webhook credential command and a safe status projection if none already exists. Store secret material only in a server-managed secret store or encrypted server-side storage, never in the graph, Definition, browser projection, or Run History. Show the secret once on creation/rotation; show only credential status and rotation time afterward. Keep the existing HMAC canonical message, timestamp window, event UUID, body validation, and idempotent Run creation. The webhook handler resolves the secret through the new server credential seam while retaining support for existing environment-backed secrets during migration. Secret rotation must support a bounded overlap or an explicit cutover procedure so delivery does not break unexpectedly.
- A webhook test uses the same signed ingress and published Definition as production. It must not bypass signature, schema, replay, or tenant checks. Display a generated event ID, accepted Run ID, and safe failure category. Do not put a webhook signing secret into browser test code beyond its one-time administrator handoff; prefer a server-side test command that signs and submits through the same verification path.
- The manual Start form uses the Trigger's schema and submits the entered input to the existing `workflow.start` command. A webhook-mode Definition shows connection and test controls and does not offer a manual Start action that the service will reject.
- The Approval panel configures the existing timeout and explains that it protects the immediately following MCP node. The run view presents a server-derived, redacted review projection for the pending effect: Workflow Definition revision/digest, installation, capability, target, permitted argument labels or safe summaries, arguments digest, and expiry. It must be built from the pinned run and resolved arguments, never trusted from browser-supplied text. The existing `workflow.approve` command and binding-digest/version check remain authoritative. Rejection and timeout end without dispatch.
- The MCP panel reuses Connector Installation, certified Manifest, and Capability Grant data. A schema-driven argument mapper supports constants and currently supported `$input.field` and `$node.<id>.<field>` references, with type checking. It persists the existing `installationId`, `capability`, `manifestDigest`, `grantId`, `target`, `arguments`, and bounded policy fields. Preserve the administrator grant command and enforce grant, certification, manifest pin, risk, and Approval requirements on the server.
- Keep the private MCP agent and public HTTPS connector routes, idempotent effect IDs, possible-send state, unknown-outcome handling, and administrator reconciliation unchanged. Canva is an example tenant-owned certified MCP server and Capability, not a built-in adapter or promise of a particular Canva API operation.
- The Memory panel exposes the current limit, character bound, and node policy without changing Memory scope or import rules. End has no runtime settings. The run view retains redaction, receipts, waiting state, and tenant isolation while making statuses and branch outcomes legible.
- Update the accepted workflow decision record with the chosen webhook credential storage and rotation contract, ingress test contract, and frontend migration behavior. Keep the glossary as terminology only.
- Release in compatible increments: typed inspectors and branch labels first; safe webhook provisioning/test and Approval review projection behind server authorization next; then manual input and run-status polish. Avoid changing the Agent implementation or unrelated platform surfaces.

## Testing Decisions

- Test user-visible behavior at the highest existing seam: authenticated browser commands and projections through draft save, server check, publication, webhook/manual start, Condition routing, Approval, MCP dispatch, and Run History. Use the existing workflow end-to-end test style rather than testing component internals as the main evidence.
- Add browser interaction coverage for selecting each non-Agent node, editing its controls, saving and reloading an existing graph-v1 draft, labeling true/false edges, correcting validation issues, and displaying role-appropriate actions. The test should assert persisted graph and visible outcome rather than local state setters.
- Add ingress contract coverage for valid signed event, bad signature, stale timestamp, replayed UUID, invalid input, tenant mismatch, missing/rotated secret, and no duplicate Run. Reuse the webhook handler and workflow store seam rather than a parallel mock-only implementation.
- Add one end-to-end Canva-shaped fixture with a certified generic MCP capability. A `ready` event reaches Approval then one effect; a non-ready event follows the false End path; reject and timeout dispatch no effect. Assert the binding digest still protects exact arguments, and tenant-scoped projections do not expose raw secret material.
- Keep regression checks for manual workflows, existing environment-backed webhook secrets, existing draft revisions, Agent nodes, Memory imports, private connector polling, unknown outcomes, and fixture/live separation. Run repository typecheck and relevant existing workflow/browser suites once implementation is complete.

## Out of Scope

- Agent inspector, model policy, prompt editing, and Agent execution changes covered by the separate Agent implementation.
- Direct database subscriptions, polling, schedules, or new Trigger modes.
- Executable Skill, Retriever, HTTP request, or outbound Send webhook nodes.
- Managed Canva integration or assumptions about a specific Canva MCP Capability Manifest.
- Parallel execution, joins, loops, sub-workflows, or changes to V1 Condition operators.
- Changes to MCP dispatch/reconciliation semantics or Approval authority rules.

## Further Notes

The current live Start control submits `{}` and the current inspector edits JSON; these are the immediate usability failures for a schema-bearing webhook scenario. The proposed integration seam is the existing browser command/projection API plus the server's published graph check; this can be reviewed with the user before implementation without blocking this spec. The local Markdown issue directory is this project's issue tracker, and `ready-for-agent` is its triage status.
