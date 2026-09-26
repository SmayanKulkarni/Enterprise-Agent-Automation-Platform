# Diagram to durable Workflow Definition V1 integration

## Problem Statement

A tenant editor can arrange a graph in Solution Studio, but its Save revision and Run check controls currently change local browser state only. The server has a tenant-scoped Studio draft store and command interfaces, yet the deployed browser host does not register those commands. The current Studio draft shape describes agent teams and stages, not the graph shown in the editor. The Case runtime, Capability Gateway, and Memory retrieval logic are deterministic or in-memory seams; there is no live Workflow Run orchestrator, MCP transport, private connector agent, or persistent Run History. A user therefore cannot safely publish the visible graph and run it as an authorized, durable LLM workflow.

## Solution

Make the existing Solution Studio graph a real tenant-scoped authoring surface. Save its full configuration through the authenticated browser command path. At publication, validate and compile a supported, sequential graph into an immutable Workflow Definition. Let a tenant admin review and publish it, then start Workflow Runs from manual or verified signed-webhook Triggers. Interpret the pinned definition with durable, sequential node execution; keep model calls, Memory retrieval, and Capability invocations in activities. Persist Run History and expose redacted, tenant-scoped status, approvals, receipts, and reconciliation through the existing browser transport. Keep fixture/local demonstration data visibly separate from live evidence.

## User Stories

1. As a tenant editor, I want to load my saved draft in Solution Studio, so that a browser refresh does not discard my graph.
2. As a tenant editor, I want to save nodes, connections, node configuration, and layout together, so that the next edit starts from the exact saved revision.
3. As a tenant editor, I want stale saves to report a revision conflict, so that another editor's changes are not overwritten.
4. As a tenant editor, I want validation errors attached to the affected node or connection, so that I can repair the draft before publication.
5. As a tenant editor, I want the V1 library to offer Trigger, Memory, Agent, Condition, Approval, MCP, and End nodes, so that every publishable node has defined execution behavior.
6. As a tenant editor, I want unsupported existing demonstration blocks identified as unavailable for publication, so that their presence cannot silently change a Workflow Run.
7. As a tenant editor, I want one clear start, reachable end states, and explicit Condition branches, so that the path a run takes is predictable.
8. As a tenant editor, I want a draft check against the saved revision, so that the release evidence matches what I submitted.
9. As a tenant editor, I want to see certified Capability Manifests and available Capability grants, so that an MCP node references an authorized operation rather than a label.
10. As a tenant editor, I want to choose bounded node policies, so that model work and external effects cannot exceed published limits.
11. As a tenant admin, I want to see the compiled graph, Capability risk tiers, model policy, and validation evidence before publication, so that I can approve the exact behavior being released.
12. As a tenant admin, I want only a complete and current manifest to be publishable, so that changed or uncertified Capabilities do not gain authority through an old draft.
13. As a tenant admin, I want publication to create an immutable Workflow Definition revision, so that edits cannot change a running workflow.
14. As a tenant admin, I want a Connector Installation bound to a certified Capability Manifest, credentials, route, and health state, so that a workflow calls only installed Capabilities.
15. As a tenant admin, I want to enroll a private connector agent with a one-time displayed, revocable installation token, so that my Extension remains inside my network.
16. As a tenant admin, I want to rotate or revoke that token, so that a compromised or retired installation stops receiving work.
17. As a workflow operator, I want to start a published revision manually with validated input, so that an approved workflow can be run on demand.
18. As a webhook sender, I want a signed, replay-protected Trigger, so that an event can start one authorized Workflow Run.
19. As a workflow operator, I want to see the pinned Workflow Definition revision and input digest on a run, so that I know which instructions were executed.
20. As a workflow operator, I want to see ordered node states and outcomes, so that I can understand where a run is waiting or has failed.
21. As a workflow operator, I want a run to continue after a worker restart without repeating confirmed effects, so that recovery is safe.
22. As a workflow operator, I want offline private installations to wait until their node deadline, so that transient disconnection does not silently fail a run.
23. As a tenant admin, I want uncertain Capability outcomes marked for reconciliation, so that a possible external effect is not repeated blindly.
24. As a tenant admin, I want to approve one exact effect bound to revision, Capability, target, and arguments digest, so that approval cannot be reused for a different action.
25. As a tenant admin, I want a failed node to stop the run and retain earlier receipts, so that I can inspect prior effects before starting another run.
26. As a workflow operator, I want the Agent node to use its published provider and exact model, so that a later model configuration change does not alter the run.
27. As a workflow operator, I want a published fallback used only before any Capability execution, so that model switching cannot reinterpret a run after an external effect.
28. As a tenant admin, I want OpenRouter disabled unless both tenant and workflow opt in, so that Azure OpenAI remains the default provider.
29. As a workflow operator, I want an Agent node's output checked against its published response schema, so that invalid output cannot drive a Condition or Capability.
30. As a workflow operator, I want Memory retrieval limited to validated, source-linked summaries in the Workflow Definition scope, so that raw Run History is not inserted into prompts.
31. As a tenant admin, I want an explicit Memory Import for another Workflow Definition, so that summaries never become shared tenant memory implicitly.
32. As a workflow operator, I want a completed run to remain complete when summary generation fails, so that post-run memory work does not rewrite the outcome.
33. As a tenant admin, I want summary failures visible and invalid summaries excluded from retrieval, so that Operational Memory remains trustworthy.
34. As a tenant member, I want tenant switches and sign-out to clear cached workflow data, so that another tenant's draft or Run History is never shown.
35. As a tenant member without publication authority, I want publication and sensitive governance commands denied by the server, so that browser role controls cannot grant authority.
36. As a tenant admin, I want fixture checks and synthetic projections clearly marked, so that demo evidence cannot satisfy a live publication gate.

## Implementation Decisions

- Reuse the existing browser transport envelope, Clerk session verification, tenant selection, idempotency key, expected-version check, and tenant-epoch fencing. Register the already declared Studio command handlers in the deployed host. Add only the run and installation commands/projections needed for V1 through the same contract boundary; do not create a second browser API.
- Keep the existing editor as the authoring surface. Make its Save, check, review, publish, run, and status controls call real server commands when configured. Replace the browser-only role switch, email form shortcut, local revision counter, fake evaluation success, hardcoded connections/models, and hardcoded run metrics as sources of live authority or evidence. Demonstration mode may remain, labeled fixture and unable to publish or invoke a Capability.
- Resolve the mismatch between the current graph model and the server's agent-team/stage Studio draft. Persist graph authoring data as a versioned draft inside the existing Studio lifecycle, with a narrow conversion at publication to the executable Workflow Definition. Preserve existing reusable package and agent-team behavior; do not reinterpret old Studio drafts as executable V1 graphs.
- V1 executable node kinds are exactly `trigger`, `memory`, `agent`, `condition`, `approval`, `mcp`, and `end`. Existing `skill`, `retriever`, `http`, and `webhook` blocks may be migrated only when their semantics map explicitly to a supported node; otherwise display a publication error. The current sample graph has a join and no End node; treat it as a fixture or convert it to a valid sequential sample before offering publication.
- Publication validates unique node IDs, supported kinds, a single Trigger, at least one reachable End, no dangling or unreachable nodes, no cycles, no parallel fan-out or joins, type-compatible data mappings, finite node policies, explicit Condition outcomes, certified manifest versions, required Capability grants, and current model/provider policy. Reject unrecognized or missing fields at trust boundaries. Coordinates and visual labels remain authoring metadata, never execution authority.
- The compiler produces an immutable Workflow Definition with explicit successor rules, node configuration, schema and policy pins, Capability Manifest and grant pins, published model policy, and a canonical digest. Credentials, bearer tokens, and secret material stay outside the definition. A Workflow Run pins the definition revision and validated input snapshot.
- Editors may save drafts and run checks. Only tenant admins may publish after current validation, manifest checks, and policy review. The current identity SQL schema records membership but no profiles, so add durable tenant role/profile authority and a trusted server resolver before enabling publication. Browser role toggles and client-supplied flags cannot satisfy this gate.
- Manual and signed-webhook Triggers use separate authenticated ingress modes. Verify webhook signature, tenant binding, freshness, and replay key before creating one run for an idempotency key. Both paths validate input against the published schema and return the same run identity and status contract.
- Use one generic Azure Durable Functions orchestration to interpret the pinned definition in sequence. Deterministic traversal, Condition selection, durable timers, and external approval events belong in orchestration; model calls, Memory retrieval, database writes, MCP requests, and secret access belong in activities. Record dispatch intent before any possible external effect and deduplicate repeated activity delivery by run, node, and effect identity.
- Persist ordered Run History, node attempts, model request metadata, approval decisions, effect intents, receipts, and reconciliation status in tenant-keyed durable storage. The current generic SQL owner tables provide a namespace but no workflow-specific persistence procedures; add the minimum atomic owner operations and indexes needed for replay, concurrency fencing, and read projections. Reuse the existing Studio draft revision/evidence tables and browser-safe projection conventions where their semantics fit; Run History is distinct from Studio test evidence.
- Reuse the Capability Gateway's admission, schema, idempotency, receipt, and reconciliation contracts, but replace its in-memory state with durable effect intent/receipt storage before live invocation. An MCP adapter calls public HTTPS Extensions or delivers commands to the private connector agent. Tenant admins certify immutable Capability Manifests; runtime authorization intersects the published grant, current installation state, tenant authority, credential scope, risk tier, and exact Approval.
- The private connector agent polls over outbound server-authenticated HTTPS with one installation bearer token. Show the token once, store only a hash, support manual rotation and revocation, and bind polling/results to that installation. Persist a command before delivery. A lost reply after possible delivery is an unknown outcome and requires administrator reconciliation; never auto-redeliver it.
- Azure OpenAI is the default model provider. OpenRouter requires tenant and workflow opt-in. Pin provider, exact model, fallback, allowed Capabilities, response schema, and prompt-template version at publication. Validate model output and Capability arguments on the server. The LLM proposes a Capability call; the server alone authorizes and invokes it. Limit tool rounds, time, tokens, cost, attempts, and effects with Node policy.
- Use the published fallback only before any Capability executes. Retry only failures proven to occur before an external effect and only within the node deadline. Three consecutive retryable pre-effect failures per connector installation or model provider open a 60-second circuit; after cooldown allow one probe. An unknown outcome never enters retry or probe logic.
- A Memory node semantically retrieves a bounded subset of validated, source-linked Run Summaries in its own Workflow Definition scope. A cross-workflow Memory Import must be explicit. Generate Run Summaries asynchronously after completion, retry generation up to three times, and make a summary retrievable only after source, schema, and scope validation. Summary failure does not change the completed run.
- Keep the demo evidence-retention default of ten days, subject to tenant Evidence retention policy and legal holds. Redact secrets and sensitive payloads from browser projections and operational logs. Preserve immutable source links and receipts for authorized review.
- Roll out through additive schema and command changes. Old package, Case, browser route, and projection behavior remains valid; live workflow actions appear only when the required authority, durable stores, provider credentials, and connector route are actually configured. No new generalized framework, dynamic code generation, or new SaaS adapter layer is required.

## Testing Decisions

- Prefer one highest-level behavior seam: an authenticated browser transport request through the registered Studio and run commands into tenant-scoped persistence, published Workflow Definition execution, and safe read projections. Use injected model/MCP boundaries at that seam so tests verify observable states and receipts without depending on implementation details.
- Test the authoring-to-run journey: save and reload a graph; detect stale revision; reject an unsupported, cyclic, dangling, joined, or ungranted graph; publish as admin; deny publication as editor; start a run; follow one Condition path; wait for Approval; invoke a Capability once; and read ordered Run History.
- Test recovery at the same seam: replay and duplicate command delivery do not repeat a confirmed effect; possible-send produces unknown outcome; reconciliation is required before any new effect; offline private agent waits to deadline; failed nodes stop and preserve receipts.
- Test model and Memory policy through observable requests/results: published provider/model pins are used, unauthorized OpenRouter is denied, fallback is blocked after Capability execution, invalid structured output stops the node, scoped summaries are bounded and source-linked, and failed summary generation leaves the run complete with no retrievable memory.
- Test tenant isolation and authority through the real Clerk/session and SQL context boundary: tenant switch or membership epoch change invalidates access; sign-out clears browser data; webhook replay is rejected; profile checks are enforced server-side. Include a fixture-mode assertion that synthetic evidence cannot satisfy a live publication gate.
- Prior art is the browser transport and Clerk session tests, Studio command/store and check tests, SQL verification scripts, Case runtime recovery tests, Capability Gateway tests, and browser contract/projection tests already in this repository. Keep narrow compiler and durable activity tests only for behavior that the higher seam cannot make deterministic or diagnose.

## Out of Scope

- Loops, schedules, sub-workflows, parallel branches, joins, and tenant-uploaded code.
- Managed SaaS adapters, public exposure of private Extensions, VPN, Private Link, and automatic agent certificate issuance or rotation.
- Dynamic LLM graph rewriting, arbitrary model-selected backend code, and automatic retry of uncertain external effects.
- Production tenant rollout, scale tuning, and expanded analytics beyond the resume-project V1 behavior.

## Further Notes

- The accepted decisions and glossary govern this spec. Existing browser, Studio, identity, SQL, Case, Gateway, and Memory components were inspected as currently implemented; several declared contracts are not registered or live yet.
- The user confirmed one end-to-end test seam through the authenticated browser API and published Workflow Run, covering draft save, admin publication, execution, receipts, and read projections.
- Implementation should update the existing workflow decision record if an integration detail must change. Keep the glossary for term definitions only.
