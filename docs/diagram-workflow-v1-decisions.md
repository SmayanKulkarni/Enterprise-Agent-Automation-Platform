# Diagram-to-durable workflow V1 decisions

**Status:** implementation in progress. This is a resume-project implementation, not a production tenant rollout.

## Foundations settled before Q25

- A diagram is authoring input. Publication validates and compiles it into an immutable Workflow Definition; every run pins its definition version and input snapshot. The durable orchestrator interprets the definition and records node results. External I/O stays in activities, outside replayed orchestration code.
- Tenant-owned MCP servers expose schema-bound Capabilities through Connector Installations. Tenant admins certify immutable Capability Manifests and grant specific Capabilities to workflow nodes. The Capability Gateway enforces authority, approvals, idempotency, receipts, and reconciliation.
- Public MCP endpoints use HTTPS. Private endpoints are reached through a tenant-operated outbound connector agent. No managed SaaS adapters, tenant-uploaded code, VPN, or Private Link in V1.
- Run History is immutable evidence, separate from Operational Memory. Source-linked summaries may become memory only within an authorized workflow scope; cross-workflow use requires an explicit Memory Import.
- Manual or signed-webhook Triggers start runs. Node policy bounds tool rounds, time, tokens, cost, and external effects. The demo evidence-retention default is ten days.

The earlier numbered Q1–Q24 transcript is not in this repository; these foundations are consolidated from `CONTEXT.md`, ADR 0004, and the provider study rather than assigned invented question numbers.

## Q25–Q37

| Question | Accepted decision |
| --- | --- |
| Q25 — private agent enrollment | One revocable bearer token per Connector Installation. The tenant admin copies it once into the agent; the server stores its hash. Use server-authenticated TLS and manual rotation. No enrollment code or rotating mTLS identity for V1. |
| Q26 — offline connector | Wait durably until the node deadline. If an external effect may have been sent and its outcome is unknown, require administrator reconciliation or an explicit retry decision; never repeat it automatically. |
| Q27 — model policy | Azure OpenAI is the default. OpenRouter requires tenant and workflow opt-in. Publication pins provider, exact model, fallback, prompt version, allowed capabilities/tools, and response schema. |
| Q28 — memory retrieval | A Memory node semantically retrieves a bounded subset of validated, source-linked summaries in its workflow scope. Raw Run History remains evidence, not prompt context. |
| Q29 — V1 nodes | Execute only `trigger`, `memory`, `agent`, `condition`, `approval`, `mcp`, and `end`. No loops, schedules, sub-workflows, or tenant-uploaded code. |
| Q30 — publication | Editors save drafts. Only tenant admins publish immutable revisions after graph validation, certified-manifest checks, and policy review. |
| Q31 — private agent transport | The agent polls the platform over outbound HTTPS using its installation token. |
| Q32 — model fallback | Use only the published fallback model, and only before any Capability executes. Never switch after an uncertain external effect. |
| Q33 — memory promotion | Generate summaries asynchronously. Once source links, schema, and scope validate, make them retrievable automatically in the same workflow scope; no admin approval. Cross-workflow retrieval still needs an explicit Memory Import. |
| Q34 — graph concurrency | Follow one graph path at a time. Parallel branches remain outside V1. Branch joins are allowed (revised 2026-09-29): a flow node may have several inputs because only one path runs, and a data mapping source must dominate its target (lie on every path from the Trigger). Either Condition branch may be left unconnected, which completes the run. |
| Q35 — lost connector reply | Persist command dispatch before delivery. If no result returns after possible delivery, mark the outcome unknown and require reconciliation; do not automatically redeliver. |
| Q36 — summary failure | The workflow run still completes. Retry summary generation separately; no memory entry is exposed until a valid summary exists. |
| Q37 — failed node | Stop the run and preserve its history and effect receipts. An admin reviews prior effects before starting another run; no automatic replay of completed effects. |
| Q38 — agent-authored memory promotion | An Agent submits an untrusted, bounded proposal with an admitted type and exact source reference. The server derives tenant, Workflow Definition, scope, and deterministic identity from validated immutable run evidence; redacts before validation; makes a matching fingerprint a no-op; and promotes valid task facts and explicitly stated preferences automatically. Invalid proposals never become retrievable. Transient validation, embedding, or vector-write failures retry three times and then remain visible as non-retrievable failures without changing the completed run. |
| Q39 — memory scope and import | Operational Memory defaults to the server-derived tenant and stable Workflow Definition ID, not a published revision; each record retains its producing revision and source provenance. User- or Agent-owned items additionally require the same validated owner on retrieval. A tenant admin publishes a target-revision-pinned, live Memory Import to a source Workflow Definition; it exposes newly promoted eligible source records while active, never crosses tenants, and preserves source ownership filters. Revocation is prospective. Grant, revoke, and retrieval are audited; a fresh server-issued request ID identifies each logical operation and is reused on retry, while the Q38 fingerprint guards duplicate records. |

## Retry circuit breaker

Retry only failures known to have happened before an external effect, such as a rejected or unavailable connection. Keep retries inside the node deadline. After three consecutive retryable failures for one connector installation or model provider, open that endpoint's circuit for 60 seconds. While open, do not dispatch new attempts; waiting nodes continue toward their deadlines. After cooldown, allow one probe: success closes the circuit, failure reopens it. A known successful request resets the failure count.

An unknown outcome never enters an automatic retry or half-open probe path. A published fallback model may be used while the primary provider's circuit is open only under Q32's pre-capability rule. Summary generation is a separate safe job: retry it up to three times with backoff, then record failure for operator visibility without changing the completed run or exposing invalid memory.

## Next-session implementation boundary

Implement the compiler and published definition, sequential durable execution, model and MCP adapters, connector polling, bounded retry/circuit state, run evidence, and automatic summary promotion in that order. Reuse the existing Capability Gateway's idempotency and reconciliation seams. Preserve unrelated working-tree changes. No further design interview is required before starting this agreed V1 scope.

## Workflow implementation integration

- Workflow Run reconciliation belongs to the Workflow module. An administrator's disposition changes only the unresolved effect and records a terminal Run History transition; the SQL adapter commits both writes in one transaction. The browser command validates the request and returns the receipt.
- The browser transport validates registered commands with a declared argument schema through the shared decoder before invoking a handler. Owner-specific domain checks remain with their modules; legacy handlers without a schema keep their existing contract, and commands without a live handler remain unavailable.
- Operational Memory keeps its current proposal and retrieval rules where they are. A deeper module waits for a rule that is genuinely shared across callers.

- Authenticated Azure SQL adapters share one connection-pool promise per connection string. Rejected or errored pools are evicted, while every request still invokes its tenant- and epoch-fenced procedure. This follows the [node-mssql pool guidance](https://github.com/tediousjs/node-mssql#connections) to retain a pool for the process and close it only at shutdown.
- Run History is a forward-only, tenant-fenced keyset page over `(created_at, id)`. Migration 009 reuses the existing run-history index, returns children only for selected Run IDs, and keeps the cursor as navigation state. The deployed query plan remains an operational check because this workspace has no configured Azure SQL connection.

- OpenRouter model identifiers are exact configured slugs. The browser receives only the allowed slug and structured-output capability, while the tenant key remains server-only. Check and publish both reread tenant connection state and the configured allow-list; a fallback must be another certified exact model with structured-output support.
- Below 820px the live block library remains in document flow above the canvas and inspector. The canvas keeps its existing scene and zoom model, while native buttons retain keyboard access.

- OpenRouter credentials use a tenant-bound AES-256-GCM envelope, authenticated with the tenant ID, provider, and wrapping-key version. Studio submits them only through a dedicated authenticated route; projections and receipts retain only enabled state and verification time. Worker dispatch resolves the active tenant record at request time and requires an exact server-configured model allow-list.

- Graph drafts use the existing Studio revision and evidence tables. The compiled definition excludes canvas labels and coordinates from its digest. The live publication procedure requires a passing check for the current draft revision and the exact compiled digest.
- Tenant membership profiles are stored separately from membership status and checked by SQL owner procedures. The browser never supplies an authoritative role.
- Workflow runs, effect intents, summaries, installations, grants, and circuit state use tenant-keyed SQL records with version checks. Durable Functions keeps only deterministic traversal and wait timers in orchestration; activities perform I/O.
- A private connector poll changes an enrolled installation from offline to healthy. Possible delivery is persisted before the command is returned. A repeated result with the same outcome is accepted, while a different result is rejected.
- A node deadline is stored on its run before model or Capability work. Provider and connector circuit state is shared within the tenant. Durable timers wait for a circuit probe or the node deadline. Summary generation retries in Durable Functions and records failure without changing a completed run.
- Cross-definition Memory Import pins one validated source summary by run ID and digest to one target definition. Memory retrieval admits that summary only while the import is active and the source digest still matches.
- Live checks require configured credentials for every Agent provider. Fixture projections remain labeled fixture and cannot create publication evidence.

## Agentic memory extension constraints

The additive agentic memory plan covers both Run Summary retrieval and Agent-authored facts or preferences. An Agent may propose a durable item, but only server validation can make it retrievable. Agent-authored items default to the same Workflow Definition scope. A workflow retrieves memory only through an explicit Memory node; Agent nodes do not retrieve it implicitly. The exact record, validation, import, retrieval, storage, and lifecycle contracts remain open in the [agentic memory Wayfinder map](../issues/agentic-memory-v1/map.md).

The accepted V1 record boundary admits task facts directly supported by validated run input or events and preferences explicitly stated by an identified user in validated run input or events. Each immutable item carries a source ID and digest, tenant and Workflow Definition identity, and a subject when applicable. Unsourced claims, inferred personal traits or preferences, secrets, and new instructions are excluded. Detailed promotion, conflict, retrieval, and lifecycle contracts remain in the Wayfinder tickets.

For the additive agentic memory extension, Upstash Vector is the selected hosted Operational Memory backend. Embedding and summary models are per-tenant Model settings chosen by a tenant administrator: no environment default and no model allowlist. Agent steps, the summary model (with optional fallback) and embeddings pick exact models from the live OpenRouter catalog when the provider is OpenRouter; Azure OpenAI takes a deployment name. Embedding provider is `upstash` (built-in, default), `openrouter`, or `azure-openai`. Non-built-in embeddings must return vectors matching the index dimension (`UPSTASH_VECTOR_DIMENSION`, default 384), verified by a test call on save. Each vector carries an `embedding` profile tag and queries filter to the tenant's current profile, so vector spaces never mix and there is no cross-provider embedding fallback; changing the profile leaves earlier items stored but not retrievable until they are corrected or re-created. OpenRouter cost is the per-request `usage.cost` it reports, with `WORKFLOW_OPENROUTER_MAX_COST_PER_1K_TOKENS` only as a fallback. The tenant `model-settings` record needs migration 010. The index is created with an Upstash built-in embedding model (`BGE_SMALL_EN_V1_5`, 384 dimensions, cosine), so the port sends text through `upsert-data`/`query-data` and no embedding provider is required. It is used through a server-only REST port with one tenant namespace passed in the URL path, deterministic item IDs, server-derived metadata filtering, bounded `topK`, and a final workflow-service eligibility recheck. Existing Azure SQL Run History remains unchanged; it retains only lifecycle and audit metadata, never recoverable Operational Memory text or embeddings. The authenticated Studio uses workflow API projections and commands for source-definition imports, redacted lifecycle state, retrieval provenance, and administrator corrections or withdrawals. No browser receives vector credentials, embeddings, or raw memory text. The selected provider still requires an existing Vercel project link before its integration can provision real environment variables; the frontend must surface readiness rather than simulate the provider.

The implementation keeps the tenant allowlist disabled by default. Memory activities embed once, write pending hosted content, and promote deterministic items after the run completes; a failed or unavailable provider leaves the Workflow Run complete and returns an explicit unavailable result. Published imports are pinned to the target revision and resolve their source's stable definition at query time. Withdrawal, deletion, source invalidation, and correction change the SQL eligibility ledger before hosted vector cleanup, so stale hosted matches cannot be recalled.

## Studio operational-memory controls

- Studio operational-memory inspection renders only redacted lifecycle and retrieval provenance. It clears projections on session, tenant, and definition changes; the server maps provider exceptions to safe categories before returning a projection.

- Memory-node retrieval bounds use labeled integer controls that update only valid values and retain the existing Node policy unchanged. Agent proposal enablement is an optional top-level `memoryProposals` array in the pinned response schema; the browser never writes Operational Memory.
- Tenant administrators can shorten an item expiry through a native local date/time control, which submits the current item version and an ISO instant. The server rejects extensions, malformed values, and values beyond the retention horizon; stale, denied, and invalid outcomes remain distinct in Studio. Lifecycle retries stay automatic and bounded, with no manual retry control.

## Live authoring controls

- Empty workflow drafts remain structurally saveable. Studio clears selection, connector state, and active graph checks when a removed node owned them; server checks still require exactly one Trigger and an End before publication.

- Studio commits the tenant's saved graph from `workflow-drafts` before independent Definitions, Run History, OpenRouter connection, and model reads. Panels reuse those initial projections and retain their explicit command-triggered refreshes; an aborted or superseded request generation cannot update the active tenant view.

- Canvas zoom uses one bounded viewport transform, preserves the pointer scene coordinate, and keeps scaled geometry scrollable. Saved state is confirmed only by the matching tenant draft projection; stale revisions retain local edits until the editor deliberately reloads.

- The live library exposes only executable V1 node kinds. Fixture-only examples retain their broader node palette.
- Trigger contracts use typed fields and manual input uses native fields or line-based structured controls; neither path requires JSON entry. The existing server check and start command remain authoritative.
- Conditions select a preceding Trigger or Agent schema field and retain the existing strict equality and `true`/`false` edge values. Approval reviews are persisted server-side from the pinned Definition and resolved effect arguments; the browser receives labels and types, never raw argument values.
- Webhook credentials are tenant-scoped workflow records keyed by published Definition ID. Provisioning and rotation are administrator-only and return the generated secret once; browser projections expose only enabled state and rotation timestamps. Rotation accepts the prior credential for five minutes. While no managed record exists, the ingress accepts the existing environment-backed credential; an explicit disabled managed record fails closed.
- Administrator webhook tests create typed sample input in Studio, sign it only on the server with the active provisioned credential, and call the same ingress path as external delivery. Test results return only an accepted Run ID or the redacted category `invalid-shape`, `signature`, `freshness`, `replay`, `credential-state`, or `not-found`; retries keep the original Run and never create a second one. Editors and operators cannot invoke the test command or receive credential material.
- Run History projects the pinned definition revision and digest, redacted input field/type summary, chronological node events, condition branch, approval wait/expiry, receipt and arguments digests, and reconciliation state. It never projects raw input values or effect arguments.
- Webhook admission inserts the Run and its pending Durable dispatch intent in one SQL transaction. Replays with the same admitted Definition and input digest are acknowledged; recovery starts only pending intents and preserves any existing orchestration instance.
- Landing examples are explicitly non-live. Product guides use directional, keyboard-accessible drawers that return focus to their opener and route through the existing navigation action.
- Approval inspection and Run History consume only the existing safe projection: review labels, types, digests, event order, deadlines, decisions, receipts, and reconciliation state. They never receive raw effect arguments.

## Threadline UI refresh — public pages and Studio draft header (tickets 03/04)

- Home and Sign-in carry no unsupported claims: capability stats, the proof strip, and the Sign-in aside were rewritten to name only integrations and facts present in this repo. The old email/password fixture form and testimonial are removed; Sign-in now renders either the real Clerk flow (only under `ClerkProvider`, mirroring the existing `ClerkAccount` split) or a single "Explore fixture workspace" action.
- The Governance fixture preview has no dead control: the period, "Export report", "Open Grafana", "Filter", and "Manage" affordances are deleted rather than left inert. Its chart and portfolio each carry a real accessible equivalent (a `visually-hidden` table for the chart, a semantic `<table>` for the portfolio), and the trace view is a native `Dialog` instead of a hand-rolled backdrop.
- Studio's saved-draft flow is explicit state, not inferred from `revision`: `draftsState` (`loading | ready | failed`) governs the Draft selector, Save availability, and canvas `aria-busy`, so a failed load can never be presented as an empty saved draft. `applyDraft`/`startNewDraft` are the only two ways nodes/edges/selection/save state change together, keeping the tenant-scoped `workflow-drafts` projection, the initial load, and Reload consistent.
- A single `pending` union (`save | check | publish | start | reload`) replaced the boolean `running` flag so two commands can never show the same label; each command's disabled state and its one shared reason text come from a `reasons` object computed once per render, and Publish/Start are always rendered (disabled with a reason) instead of being hidden by `admin && candidate` / `publishedId`.
- Any edit that would discard the canvas (switching drafts, switching tenant, reloading) routes through one `guard()` that opens a confirmation `Dialog`; nothing destructive fires without it.
- Manual Start no longer uses a `window` `CustomEvent` — `Inspector` takes an `onStart` callback and a `startReason`, so the Trigger's manual-start button and the header's Start button share one `start(input)` function and one disabled/pending state.
- A failed check produces a focusable error summary (`issueNode` in `workflow-model.ts` resolves a check-issue JSON path back to its node by id or index) that moves focus to itself and lets each issue jump to and select its node.

## Threadline UI refresh — library, canvas, and Inspector (tickets 05/06)

- Node placement and connection are fully keyboard- and single-pointer-capable: `add()` centres a new node on the current viewport (falling back to `760,540` only when the canvas ref is unavailable), staggering repeated adds by `(sequence % 5) * 24`; a library click no longer needs a drag. `nodeKeyDown` moves a focused node with the arrow keys (20px, 80px with Shift), deletes it with Delete/Backspace in live mode, and Escape on the canvas clears both a pending connection and edge selection. The duplicate "+ Add agent step" action is gone.
- Edges are selectable, not one-click-deletable: each edge renders as a visible path plus a 16px-wide transparent hit path; clicking the hit path sets `selectedEdge`, and removal only happens through the canvas notice's "Remove connection" button, Delete, or a per-edge Remove button in the Inspector's new Connections fieldset (`removeEdgeFromNode`, passed down from `studio-editor.tsx`).
- `filterLibrary` (`workflow-model.ts`) is the one place library search matches label, kind, or help text; `StudioEditor` renders its empty-result message and Clear-search action from the same filtered result the groups render from, so there's no second source of truth.
- The Inspector's live "Presentation" (Step name, Canvas note, and — only for Agent — System instructions) and "Runtime" fieldsets are visually and structurally separate; `nodePurpose` (renamed from `blockHelp`) is the single map the panel header, `LibraryGroup` help text, and `filterLibrary`'s help search all read from.
- `StepSettings` dispatches by kind with no hooks of its own; the former inline JSON-textarea fallback is its own `RawSettings` component (reused by the MCP node's "Advanced: raw settings" disclosure) so every branch has a stable hook order.
- Policy fields (`PolicySettings`), the Agent response schema, the Trigger field name, and the Approval timeout all keep the typed/invalid text in local state and show a `Field` error instead of silently reverting or dropping the edit; `schemaFieldNameError` (`workflow-model.ts`) is the one place trigger-field name rules (non-empty, identifier shape, no duplicate) are enforced, called from both the blur handler and the immediate type/required change handlers.
- Responsive Studio panes are CSS-driven from two pieces of state (`pane`, `settingsOpen`) plus `data-pane`/`data-settings` attributes on `.studio-workspace` — no `matchMedia` hook, and the canvas is only ever hidden, never unmounted, so graph/zoom/scroll state survives a resize. The phone tablist and per-pane `role="tabpanel"` attributes are present at every width and are inert (hidden by CSS) above 819px.
- Fixture-only surfaces (Skills/Connections/Runtime Inspector tabs, and Harness/Evaluations/Versions Studio panes) all render a leading "Local example — not saved or evaluated." notice and drop every button that persisted nothing (`•••`, "Attach skill", "Add connection"); the fixture tab strips follow the WAI tabs pattern via the existing `moveTabFocus` helper.

## Profiling and tracing

- `pnpm profile:workflow` writes V8 CPU profiles of the workflow e2e scenario to the ignored `outputs/profiles/` directory. It measures orchestration CPU with in-memory ports; waiting on Azure SQL, model providers, MCP servers and Upstash appears only in traces.
- Azure Functions export OpenTelemetry traces to Application Insights only when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set. `telemetry.ts` loads before any function module, records SQL (tedious) and outbound HTTP (undici) spans, and removes URL query strings before export. SQL parameter values are never attached.
- Each Durable Functions `workflowStep` activity is one `workflow.step` span with tenant, run and node IDs. A failed node records its exception, so the stack stays on the server; Run History, Studio and browser responses are unchanged. Spans are created only in activities, never in replayed orchestration code.
- Tenant-visible per-call timings would require timing fields on Run History events and are deferred.

## Live browser sweep and timings (2026-09-29)

- `BrowserV1Transport` accepts an optional `onError` and calls it for every failed request before the error is normalized. The local host logs error name, code and message server-side; nothing reaches the client. Previously the normalizer flattened SQL and programming errors to a silent 400 `INVALID_REQUEST`.
- `FEATURE_NOT_READY` now maps to HTTP 501 with the `terminal` category instead of 400, so the UI reports the feature as unavailable instead of "denied, stale, or could not be verified".
- `studioRecord` accepts the string that node-mssql returns for SQL `bigint`. `asInteger` rejected it, so the first `create-draft` inserted the draft and then failed reading its own row, after which the drafts list also failed with 400.
- The local host's OpenRouter connection handler no longer dereferences a missing wrapping key; without `WORKFLOW_OPENROUTER_WRAPPING_KEY` it answers `FEATURE_NOT_READY`.
- With `AZURE_SQL_CONNECTION_STRING` set, identity comes from SQL, not `PLATFORM_LOCAL_*`. A Clerk subject needs an `identity.users` row (real issuer and subject), a current membership, and `identity.membership_profiles` rows (`admin`, `editor`, `operator`); `identity.profiles` does not grant Studio roles. An unmapped user gets a 400 and Studio shows "Service unavailable".
- Sweep ran against a scratch database on the same server, with the OpenRouter and wrapping keys removed from its env file.

### Timings

Dev server (Vite, unminified, HMR), scratch Azure SQL, live Clerk:

- Studio load: `/tenants` 2.0 s, then six parallel GETs 2.0–2.4 s each; data ready about 5.1 s after navigation. Shell FCP 76 ms, load 84 ms.
- POST `openrouter-connection` (501): 0.73 s.
- Raw round trips from this machine: SQL 0.46 s per query (occasional 1.9–2.1 s spikes, cold connect 3.0 s), Clerk API 0.29 s.
- Each authenticated request performs a live Clerk `getSession` plus one or two identity SQL calls before its own data query, so about four sequential round trips explain the ~2 s per request.

Production build (`pnpm build:showcase`, static preview, no API): JS 440.8 kB (128.4 kB gzip), CSS 43.6 kB (10.0 kB gzip); landing FCP 108 ms, LCP 132 ms, load 79 ms.

`pnpm profile:workflow`: 2.3 s run; top self time is `canonicalJson` (175 ms), an anonymous frame in contracts `index.ts` (102 ms), codecs `text` (95 ms) and `object` (77 ms), and `digest` (46 ms).

## Studio connections and Agent tools (2026-09-29)

Spec: `docs/superpowers/specs/2026-09-29-studio-connections-tools-design.md`.

- **Tool edges.** `GraphEdge.role: 'tool'` runs Agent → MCP and is not a flow edge. An MCP with a tool edge is a tool: exactly one tool edge in, no flow edges, no argument mapping (the model supplies arguments). An Agent may have up to 16 tools, each capability at most once, and needs `toolRounds` and `effects` of at least 1 (`TOOL_POLICY_REQUIRED`). An MCP without a tool edge stays a chain step, so existing definitions keep their digests (regression test in `graph-tools.test.ts`).
- **Derived grants.** Agent `allowedCapabilities` is the union of authored capabilities and attached tool capabilities, computed at compile time. Studio also adds each chain-step MCP's capability to its nearest dominating Agent when saving, so the validator's `UNGRANTED_CAPABILITY` cannot be hit by ordering of edits.
- **Compiled shape.** Condition `next` is `{ true: id | null, false: id | null }`; a null branch completes the run. Agents with tools carry `tools: string[]`; tool MCP nodes carry `tool: true, next: null` and are never stepped.
- **Runtime loop.** One Agent step runs the whole tool loop: model call → single tool call (`parallel_tool_calls: false`) → validate arguments against the pinned input schema → `invokeCapability` → append to a transcript stored on the run record (`agents[nodeId]`). Invalid arguments and unknown tool names are returned to the model as tool errors and consume a round. Limits: `toolRounds`, `effects`, node deadline, tokens, cost; when rounds or effects are exhausted the request is sent with `tool_choice: 'none'`.
- **Idempotency.** Each call has effect id `effectId(run, "<agent>:tool:<round>")`. A crash after a stored assistant tool call resumes from the transcript instead of asking the model again. `possible-send` and `unknown-outcome` stop the run for reconciliation exactly as for chain-step MCP.
- **Approval.** A non-R1 tool call pauses the run in `waiting-approval` with `waiting.nodeId` set to the Agent and a binding digest that includes the effect id, so each approval authorizes one call. Approving re-queues the same Agent step; the node deadline is extended by the paused duration. Rejection or expiry fails the run.
- **Model tools.** `HttpModelPort` sends `tools`, `tool_choice` and `parallel_tool_calls: false`, and parses `tool_calls`. Model-facing tool names are `t<index>_<capability>` so capabilities cannot collide. OpenRouter models must advertise `tools` in the catalog for an Agent with tools (`OPENROUTER_TOOLS_UNSUPPORTED`).
- **Orchestration.** The Durable orchestrator's turn cap is 1000 because approval waits count as turns.
- **Studio.** Tool ports sit under Agents and over MCPs; tool edges are dashed and vertical. Environment settings open in a right-side drawer (Provider, Models, Connectors, Webhook, Memory, Runs); hash links `#provider-panel`, `#connector-panel`, `#webhook-panel`, `#memory-panel`, `#run-<id>` open it. The OpenRouter catalog is public, so it is always constructed. Azure OpenAI offers a curated base-model list plus a free deployment name.
