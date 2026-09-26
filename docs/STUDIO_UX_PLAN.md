# Studio guidance and workflow clarity plan

Status: planning draft. This document proposes work; it does not change product behavior.

## Outcome

Make Solution Studio understandable on first use and on return visits. Users should know what each building block does, what a Trigger expects, how a run waits for approval, whether a draft is saved, and where to find the result. Improve the landing page diagrams and spacing without implying capabilities the live product does not have.

## Current behavior confirmed in the repository

| Area | What exists | Gap |
| --- | --- | --- |
| Studio example | The heading is hardcoded as “Support resolution.” Authenticated users receive a three-step Manual start → Classify request → End starter graph. Signed-out fixture mode shows a different, richer support example. | The heading implies the live draft is a support workflow, and the fixture can be mistaken for a working live example. |
| Canvas | Buttons change scale from 50% to 120%; “Fit” sets scale to 80%. The scene has a fixed 1600 × 900 extent. | No wheel or keyboard canvas zoom, no actual fit-to-content, and the wheel can scroll or invoke browser zoom. |
| Empty graph | Deleting the last node leaves `nodes` empty; the inspector still expects a selected node. | No empty-state explanation or recovery path; this is a likely cause of the blank UI. |
| Trigger | Manual and Webhook modes, typed input fields, manual sample input, and a signed webhook test exist. | Labels do not explain the difference between mode, field schema, sample input, and a real run. Webhook setup is separated from Trigger editing. |
| Inspector | Live Agent instructions are compiled into execution; step title and canvas detail are presentation fields. Some live settings use a raw JSON textarea. | The meaning and effect of many fields are unclear; fixture-only controls can suggest capabilities absent from live mode. |
| Drafts | Save sends `studio.create-draft` or `studio.save-draft` to Azure SQL. Records are scoped to a tenant and revisions are stored. On sign-in the client loads `workflow-drafts` and opens the most recently updated graph draft. | No draft picker, no explicit identity of the current draft, no dirty-state indication, and no visible prior-revision restore. |
| Approval | The live Approval node must connect directly to an MCP node. An admin can approve or reject a waiting run in Run History. A durable orchestration waits for an approval event or expiry timer. | The inspector does not show the reviewer, waiting sequence, run trace, or effect binding clearly. There is no separate worker-focused approval inbox. |
| Landing page | The hero and capability diagrams are decorative HTML/CSS with manually positioned nodes and lines. “See how it works” scrolls to the platform section. | Connectors can miss their nodes; the Studio and Governance cards link away instead of explaining themselves in place; the closing dark CTA is oversized. |

Repository evidence: `apps/browser/src/platform-app.tsx`, `apps/browser/src/workflow-model.ts`, `apps/browser/src/styles.css`, `apps/browser/src/webhook-panel.tsx`, `apps/browser/src/platform-api.ts`, `packages/lifecycle/src/studio-sql.ts`, `packages/workflow/src/{graph,runtime,service}.ts`, `azure-functions/src/functions/workflow-run.ts`, and `database/migrations/{003_solution_studio,005_diagram_workflow_v1}.sql`.

## Design direction

Three viable approaches were considered:

1. **Recommended: contextual guidance inside existing screens.** Keep the current page structure, add concise explanations beside controls, a small guided example, a real empty state, and two landing-page explanation drawers. Reuse current server projections and commands. This addresses the reported confusion with the smallest surface change.
2. A full onboarding wizard before the editor. This could teach a fixed route well, but it delays experienced users and leaves everyday field-level confusion unsolved.
3. A redesign of Studio and Governance as one new workspace. This could improve consistency, but it requires navigation and data-model decisions beyond the issues reported here.

The first approach is the intended scope. Keep help visible on every visit, with optional deeper disclosure. Do not make a one-time tour the only source of explanation.

## Workstream A: Studio shell and editing guidance

Replace the bare “Support resolution” presentation with a clearly labeled starter example, a short description of what its three live nodes do, and a visible distinction between fixture preview and live workspace. After a draft is loaded, show its identity and revision rather than continuing to present it as a generic support example. Avoid claiming a separate workflow name field exists until it does.

Add a compact “Build a workflow” explanation near the library: Trigger starts a run; Agent produces structured output under a policy; Condition routes; Approval pauses before a sensitive MCP effect; MCP invokes an authorized Capability; Memory reads permitted prior context; End completes the run. Each block should have one sentence before selection and a slightly richer explanation in the inspector. Keep the graph validator authoritative.

For live inspector controls, put plain-language help before the first field and short helper text where meaning is easy to miss. Explain that Step name labels the node, System instructions guide the Agent at runtime, response schema defines the Agent output, and policy limits bound time, tokens, cost, and effects. Do not describe raw settings JSON as a polished visual editor. Help text should reflect the selected node and avoid fixture claims such as skills already being attached in live mode.

Trigger guidance should show a small example for both modes. Manual: “A person starts a published workflow with values matching these fields.” Webhook: “An external system sends a signed event; the same field schema validates its body.” Define field name, type, and Required in ordinary language. Separate “define fields” from “try a sample run.” When Webhook is selected, point to the published credential and signed test section, and explain that publishing is needed before an endpoint can receive events. Make existing validation errors adjacent to their fields.

When all nodes are removed, render a deliberate empty state inside the canvas: “This draft has no steps,” an Add Trigger action, and a one-line explanation that a valid published workflow needs one Trigger and an End. Render an unselected inspector state rather than dereferencing a missing node. Deleting a node should clear stale selection and connection state. Saving an empty draft can remain allowed if the server accepts it; checking or publishing should show the existing validation errors clearly.

## Workstream B: canvas navigation

Use wheel movement over the canvas to change canvas scale and retain the point under the pointer. The change applies only while the pointer is over the canvas. Support `+`, `-`, `Ctrl`/`Cmd` + `+`, and `Ctrl`/`Cmd` + `-` while the canvas itself has keyboard focus; ignore typing inside form controls. Prevent the browser zoom gesture only for handled events inside the focused canvas. Document the shortcuts next to the existing buttons. Retain browser page zoom outside the canvas.

Use one scale calculation for buttons, wheel, and keys, with explicit lower and upper bounds. Make Fit calculate the bounding box of visible nodes with padding; for an empty graph, center the starter area. Recheck drag/drop and connection hit testing after scale changes, since current pointer conversion assumes canvas coordinates without scroll offsets. Preserve readable node text at minimum scale and allow canvas scrolling where the graph exceeds the viewport.

## Workstream C: saved revisions and return visits

Save is already server-backed: the authenticated client sends the graph through the browser API to `studio.create-draft` or `studio.save-draft`; Azure SQL writes a tenant-scoped draft head and immutable revision row. The same account can sign out and back in and load a saved revision when it still has access to that tenant and the backend is available. A second member of that tenant can also see it under the current tenant-wide listing policy. Fixture preview cannot save.

The command uses an `Idempotency-Key` plus an expected revision. The client reuses a key for the same command payload during the lifetime of its `PlatformApi` instance; the SQL procedures return a prior receipt for the same key and payload, reject key reuse with different content, and reject stale expected revisions. This guards retries and concurrent writes. A full page reload or new sign-in creates a new client key map, so the UI should not promise recovery of an ambiguous in-flight save across sessions. A fresh Save on unchanged content can create a new revision; it is not content deduplication.

Plan a visible “Unsaved changes / Saving / Saved as revision N / Save failed” status, with the draft ID available in a details view. After successful save, refresh the server projection or otherwise confirm the persisted revision before announcing it. Add a draft selector using the existing tenant-scoped list, since always opening the most recently updated draft can surprise returning users. Keep selection scoped to the authenticated tenant, and offer a safe stale-revision reload path before retrying a conflicting save. A historical revision browser or restore command is a later, separate backend/UI design; current Versions in fixture mode is not proof of that live capability.

## Workstream D: approval explanation and trace

Explain the existing live sequence in the Approval inspector and in Run History:

```text
Agent output → Approval node → run stored as waiting-approval
             → tenant admin reviews the pending run
             → approve: exact bound MCP effect runs, then graph continues
             → reject or timeout: run stops with history
```

The approval is bound to the run, published definition digest, Connector Installation, Capability, target, and arguments digest. The reviewer sees safe labels, types, and digests, not raw effect arguments. The admin decision checks current run version and expiry before recording an event. The durable orchestration waits for the matching event or timer and then resumes. The MCP step checks the matching approval before invoking an effect. Run History already carries the definition revision, event sequence, wait deadline, and effect receipt; the UI should group these into a readable timeline and label the pending admin action. Rejection, expiry, stale decision, and unknown external effect need distinct descriptions.

For a Canva example, frame it conditionally: an admin-certified Canva MCP Capability and grant must exist, the Agent must be allowed to use it, the graph must place Approval immediately before the Canva MCP node, and a published run must reach that node. An approval then applies to that run's particular Canva operation, not to a worker's blanket access. No Canva-specific installation or worker-focused approval inbox was found in this repository. Do not claim cross-product propagation to a separate “worker focus” surface. If that surface is later introduced, it should link to the existing tenant/run/definition/node/effect evidence IDs and enforce the same admin authority; it should not create a second approval state.

## Workstream E: landing page clarity

Increase hero breathing room by adjusting the text/preview balance and the gap at desktop and narrow widths. Rebuild the decorative hero and Studio diagrams with connectors whose endpoints are derived from the node layout, or use a compact SVG with a shared coordinate system, so arrows meet node edges across breakpoints. Keep captions consistent with real live behavior; avoid labels and performance claims that are only fixture art.

Keep “See how it works” as a clear path to the capability section, then add in-place explanations for the two capability cards: Solution Studio opens a right-side drawer and Governance opens a left-side drawer. Each drawer should describe its purpose, the first useful action, what information appears there, and one route into the actual screen. Support keyboard open/close, Escape, focus return, visible close controls, and a mobile full-width layout. Explain that the authenticated Governance route currently shows a fixture preview rather than live governance data; the drawer must not promise a live dashboard.

Tighten the Studio and Governance illustrations so their arrows and captions are legible. Reduce the height and padding of the final dark “Make the next workflow visible” CTA while preserving a strong primary action. Maintain spacing through responsive breakpoints and respect reduced-motion settings for drawers and existing landing animations.

## Delivery order and acceptance checks

1. **Canvas safety and guidance:** empty state, selected-node guard, accurate starter labeling, block and field explanations. Check delete-all, add-back, keyboard access, and fixture/live wording.
2. **Canvas navigation:** wheel and keyboard zoom, pointer anchoring, true Fit, and scaled drag/drop. Check mouse, trackpad, keyboard, and browser page zoom outside the canvas.
3. **Draft confidence:** saved/dirty/error states and tenant draft selection on return. Check sign-out/sign-in persistence, same-tenant visibility, other-tenant denial, duplicate retry receipt, and stale revision conflict.
4. **Approval story:** readable pending review and run timeline, with the Canva example as explanatory copy only. Check approve, reject, timeout, stale review, and matching effect receipt in Run History.
5. **Landing presentation:** responsive spacing, connected diagrams, directional drawers, and smaller CTA. Check desktop/mobile layout, focus management, and that copy matches live routes.

The implementation should reuse the current React components, server projections, graph validation, and durable approval flow. No new provider or storage dependency is needed for this plan. Changes to workflow semantics or a cross-product worker inbox would need their own design and, if accepted, their decisions should be recorded in `docs/diagram-workflow-v1-decisions.md`.

## Limits of this review

This is a source-level inspection, not a deployed-browser or live-database verification. It confirms the code paths and planned behavior, but actual visual breakpoints, a live same-account return, and a live external MCP approval should be exercised during implementation verification.
