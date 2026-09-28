# Threadline interface refresh

Status: approved design for planning. This document does not authorize application implementation.

## Outcome

Preserve Threadline's Geist typography, warm off-white surfaces, charcoal structure, and restrained green signal color. Make every mounted screen and interactive element understandable, responsive, accessible, and honest about whether it is live or fixture data. Every wait, empty result, validation failure, access change, unavailable service, and uncertain action must lead to a clear next step. Keep the existing workflow, tenant, and permission semantics authoritative on the server.

The refresh covers the mounted home, Studio, Governance, and sign-in routes; their shared shell and overlays; and every control and state reachable from them. It inventories the unmounted tenant shell and contract-only collection routes so navigation cannot imply that those are live pages. It does not add a catalog, operations console, legal policy text, new provider, new workflow capability, or operational data feed.

## Evidence and boundaries

- apps/browser/src/main.tsx mounts platform-app.tsx. Its routes are home, studio, governance, and sign-in. Unknown paths currently resolve to home.
- apps/browser/src/app.tsx is a separate, unmounted tenant shell. apps/browser/src/platform-routes.ts lists collection routes that do not currently mount product pages. packages/browser/src/index.ts marks broad projection and command route inventory as not ready, though specific workflow commands are wired elsewhere.
- apps/browser/src/platform-app.tsx contains landing, Studio, fixture Governance, sign-in, and route behavior. Studio's active subpanels are connector-panel.tsx, openrouter-connection-panel.tsx, webhook-panel.tsx, memory-import-panel.tsx, and workflow-memory-panel.tsx. platform-api.ts is the browser error and request boundary. styles.css contains the current visual system and responsive rules.
- docs/STUDIO_UX_PLAN.md already covers initial Studio guidance, canvas navigation, draft confidence, approval trace, and landing clarity. This spec incorporates those accepted seams and extends coverage to all mounted UI and state behavior. It does not reopen workflow execution decisions in docs/diagram-workflow-v1-decisions.md.
- Fixture Studio and Governance were inspected in the browser at desktop and 390px width. The authenticated Studio path was inspected from source; a live tenant, provider, and SQL-backed workflow were not exercised. Visual implementation must verify that path with an authorized test account.
- The existing graphify-out report is dated September 26 and omits newer panel files. The direct entry-point, import, route, and API trace is the blast-radius basis for this spec.

## Approaches considered

1. **Coordinated refresh of the current React UI (chosen).** Establish shared tokens and state behavior in the current shell, then improve each mounted screen. This keeps existing contracts, fixtures, and visual identity while making the whole interface coherent.
2. **Replace controls with an installed component library.** Fluent UI is installed, but migrating the whole app before fixing route semantics, fixture claims, and action states would widen the change. Revisit only if the existing controls cannot satisfy accessibility and consistency after the targeted refresh.
3. **Restructure product navigation around future collections.** This could eventually unite Studio, catalog, and operations, but the collection pages are not mounted live surfaces. Design them separately when their data and command authority are implemented.

## Shared interface foundation

Use the current CSS and React patterns. Define a small, explicit token set for surface, text, border, focus, success, warning, danger, spacing, radius, and motion. Keep the present brand palette; measure contrast in each state before finalizing token values. Set a readable text hierarchy for body copy, labels, metadata, headings, and canvas detail; avoid the current 8–11px text for information needed to operate the product.

Buttons, links, inputs, selects, textareas, disclosure controls, cards, tabs, banners, dialogs, and notices need normal, hover, keyboard-focus, active, disabled, pending, and error presentations as applicable. A disabled action must explain its prerequisite nearby. Destructive or authority-changing actions need their consequence stated before submission. Do not use a spinner as the only explanation of work.

Navigation must have explicit matching for /, /studio, /governance, and /sign-in. An unknown route, including /privacy and /terms while no policy content exists, must no longer silently become home. The footer must not offer policy links until real policy content and routes exist. Route changes set a useful document title, move focus to the new page heading or main region, preserve browser Back behavior, and respect reduced-motion preference for scroll. The wordmark, primary navigation, workspace indicator, Clerk account control, sign-in action, skip link, and footer must remain keyboard reachable at every breakpoint.

### Shared loading and feedback contract

| Wait | Presentation | Completion or recovery |
| --- | --- | --- |
| Session and tenant establishment | Full-page branded shell with a plain-language status and stable geometry. | Enter the authorized workspace, offer sign-in, explain no membership, or show a recoverable service state. |
| First load of a page region or projection | Reserve the expected panel/table geometry and identify the region being loaded. Avoid a full-page cover once the shell is ready. | Replace only that region; an empty result is distinct from a failure. |
| Refresh of already visible data | Retain the previous safe view, mark the region as updating, and disable only conflicting actions. | Update the view or show a local failure with Retry; do not clear unrelated panels. |
| Save, check, publish, start, grant, credential, memory, approval, or reconciliation command | Pending label on the initiating control and a nearby status. Prevent duplicate submissions while the command is unresolved. | Show the receipt or exact next step. Retain unsaved inputs and graph edits on failure. |
| Queued workflow run or approval wait | Persistent run status, last known event, and a refresh path; no invented percentage. | Show completed, stopped, expired, or unknown-effect evidence from Run History. |
| More Run History pages | Pending state on Load older runs, with existing rows retained. | Append the next page once, or keep the current page and offer retry. |

Use a native progress element only when meaningful numeric progress exists. Announce routine changes through a polite status region, urgent failures through an alert, and loading regions through aria-busy where appropriate. Avoid multiple simultaneous announcements of the same failure.

### Error and empty-state contract

Classify the safe API error category first and use HTTP status as a fallback because this transport can map domain failures to general status codes. Do not relay server messages, stack traces, credential material, raw arguments, or provider responses. A correlation reference may be displayed only if the response supplies a safe one.

| Condition | Scope | Message and action |
| --- | --- | --- |
| Unknown route or missing record | Page | State what was not found; offer Home or the parent collection. Do not redirect silently. |
| Signed out or session expired | Page or interrupted action | Offer Clerk sign-in and return to the intended route; preserve only safe local draft state already in memory. |
| No tenant membership, denied membership, or insufficient role | Page for workspace denial; inline for one restricted action | Distinguish no workspace from insufficient permission. Offer workspace switch or a safe parent route; do not imply a role selector changes server authority. |
| Invalid input or graph validation | Form, node, and summary | Explain the field or node issue beside it and in a linked summary. Focus the summary after an attempted submission. |
| Stale draft, approval, credential, or memory version | Local action | Explain what changed, retain local edits, and offer Refresh or deliberate Reload where supported. Never silently overwrite. |
| Rate limit | Local action or region | Keep content and input, show a retry action after the available retry interval; do not auto-repeat an uncertain write. |
| Offline, timeout, malformed response, or temporary service failure | Affected region; page only if session/workspace cannot open | Explain that the result is unknown where a write may have been sent. Offer safe refresh or reconciliation; do not blindly resend an external effect. |
| Feature not ready | Page or specific panel | Name the unavailable feature and offer a working route. Do not render fixture data as its replacement in a live workspace. |
| Unexpected client render failure | Page boundary or affected panel boundary | Show a safe recovery page with Reload and Home, retaining diagnostics outside the client UI. |
| No records or filtered-out records | Region | Distinguish first-use empty from no search matches; show the one useful available action or clear-filter option. |

The dedicated visual pages are Not found, Sign in required, No workspace, Access denied, Feature unavailable, and Service unavailable. Unexpected server and client failures use the Service unavailable design with appropriate copy. Validation, conflict, rate limit, and recoverable projection failures remain near the affected work. An unknown external effect always points to the existing reconciliation evidence and authority path.

## Public pages and navigation

### Home

Audit and refine every region: hero eyebrow, headline, supporting copy, Open Studio and See how it works actions; example workflow preview with window chrome, node labels, arrows, inspector art, and run toast; compatibility strip; Studio and Governance capability cards and diagrams; both explanatory drawers; capability accordion; closing CTA; and footer. Keep example and fixture labels visible at the point of the claim. Remove unsupported performance or adapter-count claims unless backed by current evidence.

Diagram connectors must meet their nodes at desktop and mobile sizes. Provide a text description of each illustration's meaning; decorative paths and grid art stay out of the accessibility tree. The compatibility marquee must pause or become static on focus, hover, and reduced motion. The accordion uses one active item, exposes expanded state, and remains fully operable by keyboard. Both guide drawers need a visible title and close action, focus containment, Escape handling, inert background, and focus return to the opener. Use their existing route actions.

### Sign-in

When Clerk is configured, display the real Clerk sign-in and sign-up actions with a clear return destination. When it is not configured, show an explicit Explore fixture workspace action. Remove the fixture email/password form that currently waits briefly and opens Studio without authentication. Do not imply that entering credentials into a local demo form signs a user in. Show loading, invalid session, and unavailable authentication states; avoid duplicating Clerk's own validation UI.

### Footer and non-product links

Keep Home, Studio, and fixture Governance navigation accurate. Privacy and Terms are not available pages in this repo; remove their active links until actual policy content exists. The copyright and product description remain concise. External links must have a real destination and a discernible name.

## Solution Studio

### Workspace and draft header

Keep live versus fixture identity unmistakable. The header shows current tenant, draft identity/revision, and one truthful status among Unsaved, Saving, Saved revision N, and Save failed. If more than one tenant is available, switching clears the prior tenant's projections and sensitive transient inputs before showing the next tenant. Add a draft selector based on the existing tenant-scoped draft projection; distinguish a new starter draft from a saved draft. A draft load failure cannot be mistaken for a blank saved draft.

Save, Run check, Publish reviewed digest, Start run, and Reload saved revision keep their current server prerequisites and authority rules. Explain why disabled commands are unavailable. Display validation issues as a focusable summary linked to affected fields or nodes. A save success is announced only after the matching projection confirms the persisted revision. A stale save keeps local edits and requires deliberate reload. Show a small confirmation before any reload that would discard local edits.

### Library and canvas

The block search must actually filter the visible library and offer a clear no-match state. Keep live executable nodes limited to Trigger, Agent, Condition, Approval, MCP, Memory, and End; fixture-only Skill, Retriever, HTTP, and Webhook blocks remain explicitly examples. Group labels, node help, add buttons, and drag affordances should be readable and have one clear action.

Keep add, drag, click-to-connect, bounded zoom, pointer-anchored wheel zoom, keyboard zoom, Fit, scroll, selection, and delete behavior. Make connection handles large enough to target reliably, with distinct selected, connecting, invalid, and running states. A node or edge must be operable without dragging: library click adds a node, port click connects, and a selected node gets keyboard or click controls for movement and deletion. Prevent accidental deletion of a selected edge through a nearly invisible path target. Keep the deliberate empty canvas and no-selection inspector states.

At wide widths, retain the three-part library/canvas/inspector workspace. At tablet widths, make the inspector directly revealable beside or over the canvas. At phone widths, use visible Steps, Canvas, and Settings navigation so selecting a node brings its settings within reach without scrolling past the whole scene. Preserve one graph state across these layouts.

### Inspector and every node kind

Use the selected node's purpose and runtime effect as the first sentence. Step name and canvas detail are presentation fields; System instructions, schemas, policy, and node config affect execution. Keep field help next to the control rather than in a one-time tour.

- Trigger: explain Manual versus signed Webhook ingress; separate defining input fields from sample input; cover field name, type, required state, add, edit, and remove. Validate sample values beside inputs. Link webhook mode to published credential setup.
- Agent: cover provider and allowed exact model, fallback where supported, structured response schema, instructions, memory proposals, and policy limits for deadline, attempts, tokens, cost, tool rounds, and effects. Explain unavailable connection/model states. Raw JSON fields remain labeled as advanced structured input and show parse/schema errors without losing text.
- Condition: expose only reachable typed fields, the equality value, and both True and False connections. Explain missing source and incomplete branch states.
- Approval: show timeout, immediate MCP successor requirement, who may decide, and how Run History identifies wait, rejection, expiry, and effect binding.
- MCP: show certified installation, capability, manifest, grant, target, and each argument source or constant. Explain required and incompatible fields at the mapping control.
- Memory: cover retrieval bounds, provider readiness, and how a published definition's memory scope and imports affect retrieval.
- End: state that the run completes there and has no runtime settings.

Fixture-only Harness, Evaluations, and Versions tabs remain visibly local examples. Their model, fallback, token budget, capability items, evaluation status, and revision rows cannot imply a persisted live setting or real evaluation result. Remove decorative menu buttons that have no action.

### Live operational panels

OpenRouter connection shows checking, ready, absent, invalid, failed-load, and action-pending states. Only admins see key submission, rotation, verification, and disconnect controls. The key field clears after submission and never reappears in a projection. A destructive disconnect explains its effect on future dispatch.

Connector controls show loading, no certified installations, failed load, selected installation and capability, argument mapping, missing grant, and command outcomes. Administrator certification, enrollment token, rotation, and revocation each require a precise pending/result state. Preserve one-time token visibility and avoid repeating secrets in notices.

Webhook controls show the published URL, signing instructions, credential state, one-time secret, provision/rotate/disable actions, typed sample event, field validation, and each existing test outcome: accepted, invalid shape, signature, freshness, replay, credential state, and not found. Link an accepted test to its Run History entry. Never show a webhook endpoint as active before publication and credential readiness.

Memory imports show source definitions, attached sources, active/revoked state, attach/revoke actions, and load failure. Operational memory shows provider readiness, empty or failed records, redacted item provenance, retrieval evidence, and admin-only withdrawal, hold/release, deletion, source invalidation, correction, and expiry shortening. Keep their existing server authority and distinct conflict/denied/invalid expiry errors. Do not add a manual retry for server-managed lifecycle work.

Run History gets a readable overview and chronological detail for each run: status, pinned definition revision/digest, safe input summary, node sequence, approval wait and deadline, decision, receipts, and effect state. Admin Approve/Reject and unknown-outcome reconciliation actions must name their exact run and effect, show pending state, and require the current version. Empty history, failed load, refresh, and Load older runs are distinct. Keep input values and effect arguments redacted.

## Governance fixture preview

Authenticated Governance currently shows only a fixture preview, and signed-out fixture mode exposes an admin/operator role simulation. Keep that boundary in the heading, banner, metrics, chart, rows, and trace drawer. The preview role switch changes only the preview; it does not grant server permission.

Review each element: period selector, Export report, role switch, health banner, four metric cards, successful/failed runs chart, service-health rows, portfolio Filter and table rows, trace drawer summary/waterfall/event log/Grafana action, team list and Manage action, and operator access boundary. A control without a working fixture or real action must become clearly noninteractive or be removed. Period selection must update every affected fixture value or be labeled as an example-only display. The chart needs a text/table equivalent; portfolio rows need real table or list semantics and a usable narrow-screen presentation. The trace drawer follows the shared dialog behavior.

## Motion, accessibility, and performance

Use CSS transitions for hover, focus, simple disclosure, and existing drawers. Keep motion short and purposeful: it may orient a route change, drawer, accordion, or status update, but must not animate canvas geometry during pointer work or imply progress that is not measured. Replace the blanket reduced-motion duration override with targeted static alternatives where needed; no essential content may depend on animation. Do not add the Motion package for this refresh unless a verified interaction cannot be expressed cleanly with the platform and existing CSS. Motion's React accessibility and transition guidance informs any later exception.

Target WCAG 2.2 AA for mounted UI. Check contrast, visible and unobscured focus, label/name agreement, 24px minimum pointer targets or valid spacing/equivalent controls, keyboard and single-pointer alternatives to dragging, status announcements, and accessible authentication. Use the WAI tab and modal-dialog keyboard patterns. Maintain order and access at 320px, 390px, 768px, 1024px, and 1440px; test 200% browser zoom and long translated-like text without claiming localization support. The chart, diagrams, status colors, and run timeline cannot rely on color alone.

Keep already rendered content during refresh and avoid layout shifts. Measure loading behavior and interaction responsiveness before adding animation or skeleton detail. Avoid new dependencies, broad component scaffolding, and changes to the server's workflow semantics.

## Data flow and blast radius

The browser continues to receive tenant-scoped safe projections and submit named commands through PlatformApi. A small UI-level request-state and error-presentation convention may normalize loading, empty, failed, and refreshing views; it must not cache or replay uncertain writes or weaken PlatformApi validation. Server authorization, graph validation, revision checks, secret handling, and durable run/effect history remain authoritative.

Expected implementation touchpoints are apps/browser/src/platform-app.tsx, styles.css, platform-api.ts where safe error classification is needed, and the five active Studio panel files. Route and session tests may touch platform-routes.test.ts and session-state.test.ts only if their mounted behavior changes. The unmounted app.tsx and platform-routes.ts are inventory and compatibility boundaries, not a second UI implementation target. Existing dirty worktree changes in packages/browser, packages/workflow, migrations, seed, and decisions documentation must be preserved.

## Delivery slices and acceptance

1. **Shared foundation and navigation.** Explicit 404 and unavailable states; accurate footer; focus and page titles; shared field, button, notice, and loading rules. Verify unknown URL, signed-out, no membership, denied, and transient service failure.
2. **Public pages.** Landing and sign-in copy, diagrams, drawers, accordion, fixture claims, and inactive controls. Verify keyboard, narrow screens, reduced motion, and real Clerk versus fixture paths.
3. **Studio authoring.** Draft status/selection, validation, library search, canvas alternatives, mobile layout, and all inspector kinds. Verify delete-all/add-back, keyboard connections, zoom, dirty-save conflict, and tenant switch.
4. **Studio operations.** Provider, connector, webhook, memory, and Run History states and commands. Verify admin/editor/operator boundaries, secret one-time display, every webhook outcome, pending approval, rejection, expiry, stale decision, and unknown-effect reconciliation.
5. **Governance preview.** Every control, chart/table accessibility, trace drawer, mobile behavior, and explicit fixture status. Verify that no displayed action falsely promises live governance.
6. **End-to-end state review.** Exercise the error matrix with controlled network and response conditions, plus responsive, keyboard, screen-reader, reduced-motion, zoom, and slow-load checks. Capture a before/after inventory so no mounted control or state is unreviewed.

A slice is complete only when its controls have a truthful action or are clearly noninteractive; its first-load, refresh, empty, failure, permission, and pending states are addressed where relevant; and its keyboard and narrow-screen paths work. No new backend feature is required to pass this UI design.

## Research basis

- [WCAG 2.2 and its new interaction criteria](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/)
- [WAI modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) and [tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
- [GOV.UK error summary](https://design-system.service.gov.uk/components/error-summary/)
- [Carbon loading pattern](https://carbondesignsystem.com/patterns/loading-pattern/) and [MDN progressbar guidance](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/progressbar_role)
- [Motion reduced-motion guidance](https://motion.dev/docs/react-use-reduced-motion)
- 21st.dev MCP metadata references: [workflow controls](https://21st.dev/@vercel-crawled/components/controls), [error empty state](https://21st.dev/@7ovr/components/empty-states-4), [access denied](https://21st.dev/@7ovr/components/error-4), and [server error](https://21st.dev/@7ovr/components/error-3). These are visual references, not selected dependencies or copied implementations.

The bundled Deep Research API script could not run because OPENAI_API_KEY was not available. The research basis above uses primary web guidance, Motion MCP documentation search, 21st.dev MCP inspiration metadata, direct source inspection, and a fixture browser review.
