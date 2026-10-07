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

## Agent memory tool, revision history, admin test account (2026-09-29)

Spec: `docs/superpowers/specs/2026-09-29-studio-agent-tools-design.md`.

- **Memory tool.** A Memory step may be an Agent tool: exactly one tool edge in, no flow edges, at most one per Agent (`DUPLICATE_TOOL`), and it counts toward the 16-tool limit. It compiles to `{ kind: 'memory', tool: true, next: null }` and adds no capability, so `allowedCapabilities` is derived from MCP tools only and definitions without memory tools keep their digests. The Studio mirrors every rule in `toolError`, so an edge the editor accepts is one the compiler accepts.
- **Memory calls.** The Agent gets `memory_search({ query })` and `memory_save({ type, text, excerpt, subject? })`. Search shares `selectMemory` with the Memory step and records provenance under effect id `memory:<node>:tool:<round>`. Save fills `sourceId = input:<runId>` and `sourceDigest = run.inputDigest` itself, stages one pending proposal through `stageProposals` (idempotent by fingerprint, so a replay never duplicates), and never promotes. Both consume a round; save also consumes an effect and fails the run with `TOOL_LIMIT` at the effect limit. Bad arguments, an empty or over-long query, and unavailable memory return to the model as `INVALID_ARGUMENTS` or `MEMORY_UNAVAILABLE` and cost a round. A stale run always propagates.
- **Tool flag.** Only an explicit `tools: false` marks a catalog model unsupported; a missing flag is unknown and allowed. The server check stays authoritative. The failure seen in Studio came from a stale `dist/` served by the Functions host; run `pnpm build:azure` and restart `func` after catalog changes.
- **Revision history.** `[studio].list_revisions` returns at most the newest 200 revisions of a draft after `assert_context`, including `draft_json`. The `workflow-revisions` projection (record id is the draft id) omits the author. Loading a revision replaces the canvas but leaves the saved revision untouched, so the editor reads as unsaved and a save appends the next revision. New node ids come from `freeSequence`, so they cannot collide with ids in a loaded revision.
- **Admin test account.** `database/seed/004_admin_test_account.sql` upserts the Clerk user for `CLERK_ISSUER` and `ADMIN_TEST_CLERK_SUBJECT`, a current membership (reactivating a revoked one with a bumped epoch) in every existing tenant listed in `PLATFORM_LOCAL_TENANTS`, and an `admin` profile. `tools/sql/admin-seed.mjs` fills the `$(ADMIN_*)` placeholders after validating the subject charset, the issuer URL, and tenant GUIDs, and skips the file when the subject is unset. It runs only with `AZURE_SQL_ALLOW_DEMO_SEED=true`. The `/governance` route renders the labelled fixture preview when auth is on; the role switch stays fixture-only.

## Governance and observability (2026-10-01)

Spec: `docs/superpowers/specs/2026-09-30-governance-observability-design.md`. Tickets: `.scratch/governance-observability/issues/01` to `18`.

Decisions:

- **D1.** A tenant group is a new entity that owns several existing tenants (workspaces); a workspace is in at most one group.
- **D2.** A run's approval can be decided by a group admin in the Governance inbox or by the workspace's own admin in Studio Run History.
- **D3.** A group admin is a full admin of every member workspace. The rights are materialized as real `identity.memberships` and `membership_profiles` rows, with the created rows recorded in `identity.group_admin_grants`.
- **D4.** Telemetry runs on a local `grafana/otel-lgtm` container and on Grafana Cloud when deployed.
- **D5.** Charts are drawn natively from our own API. Grafana is the operator's tool and is not embedded.
- **D6.** The assistant's provider and model are the admin's choice. OpenRouter uses the connection of a chosen workspace in the group, which must be a member.
- **D7.** Groups are provisioned through the Governance UI by the group admin.

Deviations from the spec:

- Migrations were split into 012 to 017 instead of two files, because an applied migration is pinned by digest and cannot be edited.
- `governance.command_receipts` and `workflow.run_facts.usage_estimated` were added. The second marks runs whose cost was estimated, so the overview can mark them partial.
- A workflow's display name is taken from the draft's trigger node title.
- MCP telemetry is recorded in `runtime.invokeCapability`, not in the port.
- The `tenant_id` metric label is set only from verified sources.
- Circuit records gained a `key`, so the health view can name the model or connector that is open.
- The assistant route has no `If-Match`, because a turn is not a versioned write. A call whose reported cost exceeds the ceiling fails the turn. `RATE_LIMITED` (429, category `retryable`) was added to the error codes; the browser reads the HTTP status for it, because `describeError` maps the `retryable` category first.
- Fixture mode has no group writes, no fake logs or traces, and hides the assistant.
- The dashboards use a data source variable instead of an exported `__inputs` block, so file provisioning works without edits. The `grafana/otel-lgtm` image has no provider for a custom dashboard folder, so `infra/observability/dashboard-provider.yaml` was added and the compose mount changed to `/threadline-dashboards`.
- `CONTEXT.md` was restored from git before the glossary entries were added, because it had been deleted in the working tree and `CLAUDE.md` names it as the glossary.

Known ceilings: the assistant rate limit is per server instance; groups hold at most 50 workspaces, which bounds the tenant regular expression in telemetry queries; the Loki tenant filter is structured metadata, not a stream label; deployed telemetry retention is 14 days, so `30d` telemetry panels are partial.


## Approval disclosure (PR gate stress test)

- A live PR and commit gate (`tools/e2e/*-prgate.mjs`) showed that an approver saw only argument names, types and digests, so a human could not tell which PR was under review or why the model suggested merge or return.
- The approval node gained an optional `disclose` list of up to six argument names of the effect that follows it. Their resolved scalar values are stored in `waiting.review.facts`, truncated to 4000 characters, and projected by the governance approvals read and Run History. Other argument values stay redacted. Unlisted or non-scalar arguments are ignored.
- Disclosure shows the effect's own arguments rather than a free-text note, so the displayed text cannot differ from what is executed and the arguments digest already binds it.
- The webhook event id is the run id, so one event id cannot start runs in two definitions. The relay salts its deterministic ids with the definition id.
- The local Vite webhook middleware now logs the error behind a 503.
- Known gaps: an approval is binary, so a human who disagrees with the suggestion cannot pick the opposite outcome or attach feedback in the same run; the inbox card title is the trigger node's title, so every gate run reads "PR or push event"; there is no cross-run link between an approval and the GitHub object it concerns beyond the disclosed fields.

## PR gate hardening (failure-class research)

Source: `docs/research/pr-gate-failure-classes.md`. These decisions turn its backlog into platform behavior. Everything below is implemented unless listed under "Not done".

- **Event id is a dedupe key, not the run id.** The webhook run id is derived from tenant, definition and event id. A replay of the same event and payload returns the original run; the same event with a different payload is 422 `application/problem+json`. No migration was needed because the stored procedure already throws `CONFLICT` for a same-id, different-payload run, and a derived id removes the cross-definition collision. One in-flight duplicate is a replay (202), not 409, because admission is atomic. One mapper (`ingress-outcome.ts`) serves Azure and local ingress. Unexpected errors are 500 problems that leak nothing.
- **Reject is not a failure.** New run statuses `rejected`, `expired`, `cancelled`, `superseded`. Migration 018 makes them terminal in `run_facts` and removes them from Governance run counts and p95. A separate Rejected series was not added.
- **Decision record.** Approvals store outcome, reason (max 1000), approver, time, binding digest and the facts shown. `workflow.cancel` lets the run's starter, or an admin, end a run that is queued, running or waiting for approval.
- **Truncation fails closed.** An agent that read truncated tool output fails with `EVIDENCE_TRUNCATED` unless `onTruncation: "allow-marked"`. The tool preview now states `bytesTotal` and `bytesShown`. A condition cannot test `evidenceComplete`, because condition fields must exist in the agent's response schema.
- **Subject and supersede.** The latest run per subject is a head record stored under the existing `webhook-dispatch` record kind with state `subject-head`, because adding a kind means rewriting several stored procedures. Delivery order is last-in wins; GitHub gives no ordering for head SHAs. An effect re-checks that its run is still the head. A change to the external object that does not arrive as a webhook (a PR merged by hand) is not detected; that needs a revalidation read and is not built.
- **Finalizer and commit status.** The finalizer is a trigger-to-MCP edge, runs on every terminal status, and is exempt from approval because only an administrator can publish it and its arguments are limited to `$input`, `$run.outcome` and `$run.id`. The commit status (`workflow/pr-gate`) is published by `tools/e2e/status-mcp.mjs`, a separate MCP server using the existing OAuth token. A missing required status already blocks a merge, so no `pending` status is sent. Phase 2 (a GitHub App using the Checks API) is not built.
- **GitHub-native ingress.** A trigger with `source: "github"` accepts GitHub's signature and delivery id, maps the payload to the input, and ignores other events. Secrets stay per definition. Body limit 1 MiB (413). The polling relay is not hardened; it is replaced by this path once a public ingress exists.
- **Timers.** Approval timeout cap is 14 days. The Azure orchestrator chains timers of at most five days (Durable timers are limited to six days in JavaScript). The local scheduler uses one `setTimeout`, which holds up to 2^31 ms.
- **Opt-in rules, to keep published workflows valid.** `dedupeKey` on an MCP step (not required on R2 and R3), `separationOfDuties` on an approval, `targetFields` on a capability. A required `dedupeKey` would invalidate every existing workflow and has no Studio control yet.
- **Capability variants and retire.** `tool` and `fixed` in a manifest. `workflow.retire-installation` revokes any installation, which closes the orphan problem (a changed manifest still needs a new installation id). Installation revisions with old pins kept alive are not built.
- **Run label.** Trigger `label` template, resolved at admission, carried by migration 019 into the approvals read as `run_label`.
- **Hygiene.** `pnpm lint` is now a ratchet over `tools/workspace/lint-baseline.json` (no file may gain errors) plus a secret scan; `pnpm lint:raw` is plain ESLint. `tools/e2e/ticket.mjs` writes the token to a 0600 file and never prints it.

Not done, with the reason:

- Approval outcomes beyond approve and reject (B10): a human's note that changes the effect's arguments after approval would break the binding digest. It needs a decision on whether the note is part of what is approved.
- Server-side filters for the `workflow-runs` projection, and agent outputs in Run History (B14): filtering after a page is fetched breaks paging and needs a stored procedure; agent output can carry input data and is not shown to every Run History reader. Approvers see what the author lists in `disclose`.
- Installation revisions with a candidate state (B12 part).
- A Studio control for `dedupeKey`, `onTruncation`, `separationOfDuties`, `label`, subject fields and finalizer edges. Workflows that use them are authored through the command API, as the gate script does.
- A live scheduler contract test against Durable Functions (B17): there is no emulator in CI. The local scheduler has contract tests, and the long-timer logic is a pure function with its own test.
- SQL changes in migrations 018 and 019 were written from the existing procedures and checked by reading and by their verify scripts, but have not been run against a database in this session.


## Agentic memory V2: formation, consolidation and recall (2026-10-04)

Spec: `issues/agentic-memory-v2/00-memory-formation-spec.md`. Phases 0 to 4 are implemented; Phase 5 (lessons) is deferred as the spec says.

**V1 baseline (audit of 2026-10-04, tenant `11111111-…`, 15 vectors).** Salience 0 of 11 run summaries named a subject or conclusion. Three active `task-fact` items restated the zod assessment. No fact carried a `tool:` source. Every Memory step and `memory_search` read the whole `memory-item` collection. Precision@5 was not measured. The offline scenario below is the V2 reading of the same metrics; the live reading needs `E2E_MEMORY_SCENARIO=1` and a funded OpenRouter and Upstash.

**Phase 0.** `tools/workflow/memory-metrics.mjs` holds the metric functions (salience, active items per subject, precision@k, bytes per item) and `tools/workflow/memory-report.mjs` reads one tenant namespace with Upstash `range`, which is read-only. The six-run fixture runs offline as a test in `agent-tools.test.ts` through the real worker with scripted model, summary and consolidation ports. The result is salience 1, one active `task-fact` per subject, tool-sourced facts 100%, no `memory-item` list during retrieval and precision@5 of 1 for the subject-filtered follow-up. Two active items per subject remain because a durable fact and an episodic run summary about the same subject are different types: a run summary cannot retire a fact, and the same-run candidates are excluded. The spec's target of 1 is met per type, not per subject. `tools/e2e/memory-scenario.mjs` drives the same six runs live and is opt-in. The e2e Agent instructions now cite tool results by call id and pass a subject.

**Phase 1.** `HttpModelPort.summarize` sends a bounded view: input (4,000 characters), outputs of completed agent, mcp and end nodes without `memoryProposalIds` and `evidenceComplete` (2,000 per node, 8,000 in total), the ordered path, decision outcomes without approver identity, and the status. Strings and secret-looking keys are redacted structurally before serialising, because the V1 `redacted()` pattern needs `key=value` text and does not match JSON. Findings are not claim-checked (the spec's own example date would fail); they are checked by exact excerpt against the unredacted source. The summary record has the states `ready`, `skipped`, `ungrounded` and `rejected`; all four settle `summaryStatus` to `ready` because the summarizer finished and replaying would give the same verdict. A malformed or over-length draft throws `INVALID_SUMMARY`, so the durable activity retries and then marks the summary failed.

**Phase 2.** `memory_save` takes `source` (`input` or a call id) and `subjects`; `memory_search` takes `subject`. The memory tool schemas live in the runtime and are not part of the compiled definition, so the definition digest does not change and there is no per-revision schema pinning to do. A claim is grounded when every number, id-like token and quoted string appears in the source at a token boundary, so `9` is not satisfied by `m95q`. V2 fingerprints drop the source and run but keep the owner and `subject` for a stated preference; without them two users' identical preferences would share one item and one `ownerId`. Staging a duplicate of a non-pending item records the extra source under `memory-consolidation/<id>` (`corroboratedBy`, at most 20) and never while the item is still pending, because a decision record created early would make promotion skip consolidation. Rejections keep the V1 `INVALID_PROPOSAL` record and add `UNGROUNDED_CLAIM`.

**Phase 3.** Candidates come from one bounded `query` and are rechecked by `workerRead` against SQL for state, definition, owner, expiry and digest. Candidates from the same run are excluded. A duplicate needs score at least 0.97, the same type and the same subjects. A model decision in the band can only retire an item of the same type, plus a durable item may retire a `run-summary` and a `run-summary` may be dropped as redundant against a durable item; a fact can never be retired by an episode. The supersede order is withdraw the predecessor, remove its vector, then promote the successor, so a crash in the middle converges on replay and never leaves two live versions. A hold is checked when the decision is made and again when it is applied. A failed or missing candidate query, a missing model port, a model error or an invalid target all record `add` with path `fallback` or `deterministic`, so a memory is never lost. The decision record holds scores, ids, model and prompt version, never text. A flip-flopping fact (1 advisory, 0, then 1 again) cannot revive the withdrawn item because the fingerprint ignores the run; the new observation is dropped as a duplicate of a withdrawn item. Accepted for now, revisit if it shows up in the live run.

**Phase 4.** Retrieval over-fetches `limit × 3` (cap 30), reads each eligible match by id, scores `0.65 × relevance + 0.25 × recency + 0.10 × type`, keeps at most two per leading subject, skips whole items that do not fit `maxChars`, and puts the label (`type id observed subjects source`) in each returned item. V1 items rank with type weight 0.3 and expire on their TTL. The Memory node query is the input's string values, falling back to the JSON text when the input has none, because an empty query would skip recall for workflows started with `{}`. The retrieval receipt carries rank inputs and no text; Studio shows them with the supersession chain.

**Deviations and gaps.** The subject key pattern allows `#` so the spec's own example `pr:acme/api#42` is valid. Expiry is 90, 30 and 180 days by type; `set-expiry` now caps at the type's maximum instead of a flat 90 days. The admin correction path keeps its V1 fingerprint and now records `supersededBy` on the predecessor. Migration 020 adds the `memory-consolidation` kind to the constraint and to `worker_write_record` only; the browser read procedure is generic, so Studio needed no SQL. Migration 020 was written from the existing procedures and checked by its verify script and by reading; it has not been run against a database in this session. `tools/e2e/memory-scenario.mjs` and `tools/workflow/memory-report.mjs` have not been run against live services. Rerun `tools/workflow/upstash-certification.cjs` after deploying Phase 3, as the spec asks.

## Judgment step (decision models)

- **Kind name.** `judgment`, shown as Judgment step. "Decision" already means an approver's outcome, so no code or UI says "decision node".
- **No fallback model.** Calibration differs between decision models, so a silent switch would change the error rate of the `act` band. Per-model thresholds must exist first.
- **Fan-out.** One node asks 1 to 16 questions in a single Decisions API call. Output is flat: `<q>_answer`, `_probability`, `_confidence`, `_band`, `_score` (score questions), plus `band`, `probabilities`, `model`, `requestId`. The overall `band` is the most cautious band among questions with `gate !== false`; with every question non-gating it is `act`. `gate: false` marks speculative questions whose answers are recorded but cannot send the node to review.
- **No memory evidence.** A probability is not a fact, so Judgment output is not in `EVIDENCE_KINDS` and makes no memory proposals. A Memory step's output can be mapped into Judgment state; the Studio warns above 3 items.
- **Aliases rejected.** `~vendor/model-latest` slugs fail `INVALID_JUDGMENT`; an alias can move and shift probabilities.
- **Bands computed in code.** Thresholds and `gate` never leave the workflow. `act` only means the model was confident; R2 and R3 effects still need an Approval and targets still cannot come from a model.
- **Noul confidence.** The API returns no confidence for yes/no questions, so it is derived as `max(p, 1 - p)`.
- **Approval facts.** Up to two Judgment facts (one line per question, then an overall line) follow the disclosed facts and partial-evidence fact; the inbox fact limit is 9.
- **Telemetry.** Each call records a `decide <model>` span, the existing `gen_ai.*` metrics with `feature=judgment`, one `judgment.call` event without state or probabilities, and `workflow.judgment.bands` per question (labels: tenant, band, question type; never the question id). The `judgment-bands` governance panel sits in the overview charts.
- **Deploy order.** Backend first (worker and validator in `azure-functions` and the API host), then the browser. An older worker fails a `judgment` node with `INVALID`, so never publish a Judgment before the worker is deployed. There is no migration and no new environment variable; cost falls back to `WORKFLOW_OPENROUTER_MAX_COST_PER_1K_TOKENS` when `usage.cost` is missing.
- **Deviations from the design.** `judgment-bands` uses the step window (`increase(...[step])`, stacked bars) instead of the whole range. `modelValid`, `policyValid` and `FACT_LIMIT` moved to `node-policy.ts` so the browser can import `judgment.ts` without pulling in `node:crypto`. State mappings also require the mapped field to exist on the source.
- **Catalog status.** The `openrouter-models` projection reports `decisionCatalog` next to `catalog`; the Judgment picker uses the former, so a decisions-only outage shows an error and retry rather than an empty list.
- **Locked policy.** Judgment's `toolRounds` and `effects` show the draft's actual value and are reset to 0 when any other policy field is edited; the server still rejects non-zero values at check.

### Live probe (2026-10-05, not CI)

Same ticket text and three questions (choice, score, yes/no). One request versus three separate requests:

| Model | One request | Three requests | Answers |
| --- | --- | --- | --- |
| `typesafe/jev-1.13` | 650 ms, 424 input and 71 output tokens, $0.0000178 | 909 ms in total, $0.0000429 | Agree: refund, score 0.97, yes 0.99 |
| `jaredpalmer/kev-4b` | 1161 ms, 100 input and 185 output tokens, $0.0000042 | 2369 ms in total, $0.0000067 | Agree: refund, score 1.02 / 1.03, yes 0.91 |

- Fan-out was cheaper (2.4x for Jev, 1.6x for Kev) and faster (1.4x and 2.0x). Calls were sequential, so the saving would be smaller against parallel requests.
- Response shapes match the design: choice and score carry `confidence` and `probabilities`; yes/no carries only `noul`. Score answers include a `legend`.
- Errors: a bad key returns HTTP 401 with `{"error":{"message":"Missing Authentication header","code":401}}`, as expected.
- `togethercomputer/tev1-4b-experimental` accepted the same mixed-type request with HTTP 200. The "choice only" limit in the design was not reproduced, but the Studio help text stays because the catalog does not advertise it.
- 422, 429 and 529 were not provoked.


## MCP self-serve (2026-10-05)

Goal: a tenant administrator connects GitHub through the product UI, with no server environment variable and no script from `tools/e2e`.

- **One credential seam.** `McpCredentialLookup.resolve(tenantId, installationId)` is the only place a connector token is read. `HttpMcpPort` uses it to dispatch and to discover tools, and the service uses it through `connectorReady(installation, tenantId)`, which may now be asynchronous. The runtime passes `tenantId` to the port by spreading it onto the installation argument, because adding a sixth argument would break the existing `toHaveBeenCalledWith` assertions. The default lookup reads `WORKFLOW_MCP_CREDENTIAL_<ID>` exactly as before.
- **Tenant credential store.** New record kind `mcp-credential`, id = installation id, state `active` or `disabled`. Migration 021 adds it to the records constraint and rewrites `write_record` from its live `OBJECT_DEFINITION` (kind list only), so the current procedure body is preserved exactly. It uses `ALTER`, which keeps the grants; the verify script checks that. The worker write procedure is untouched, so only the admin write path can create these rows. **Migration 021 and its verify script have not been run against SQL Server.**
- **Sealing.** AES-256-GCM with the AAD `tenant:mcp:installation:keyVersion`, keyed by `WORKFLOW_MCP_WRAPPING_KEY` (32 bytes, base64url) and `WORKFLOW_MCP_WRAPPING_KEY_VERSION`. This is a new operator setting kept apart from the OpenRouter key. Without it the store is off: the commands return `FEATURE_NOT_READY` and dispatch falls back to the environment variable. Opening fails closed (not-dispatched, no fallback) when a stored row cannot be decrypted.
- **Precedence.** An active tenant record wins. A disabled record (after Disconnect) falls through to the environment variable, which is never removed. Rotate and Disconnect take effect on the next dispatch because every dispatch reads the record.
- **Commands.** `workflow.connect-mcp-credential`, `rotate-mcp-credential`, `disconnect-mcp-credential` on the existing tenant command route. The token travels as the argument `key`, because the browser contract rejects argument names containing `token`, `secret` or `credential`. The request digest is an HMAC of the token, so no plain hash of it reaches `command_receipts`. The expected version is enforced by the store, and a replay returns before that check, which gives idempotency. A token may be saved before its installation is certified (discovery needs it); an existing installation must be healthy, public and certified. Status is projected as `workflow-mcp-credentials` (id, version, state, enabled, connectedAt) and never carries the secret.
- **Discovery.** `workflow.discover-tools` calls `tools/list` against the endpoint with the stored credential. It runs only for `https` hosts on `WORKFLOW_MCP_ALLOWED_HOSTS`, and fails closed on a host not on the list, a missing token or a non-https endpoint, without any outbound call. Errors are `DENIED`, `UNAVAILABLE` (unreachable, non-2xx) and `INVALID` (malformed list); nothing is written. Every tool starts at `R3`, whatever the server claims. The admin sets risk, an output result type and fixed arguments (a fixed argument leaves the input schema) and certifies through the unchanged `certify` command. The hand-written manifest textarea remains.
- **Output shape limit.** The runtime validates a result against `outputSchema`, and the result is `{ result: <value> }` unless the server returns `structuredContent`. Discovery cannot know which, so Studio offers `object`, `array` or `string` per tool and defaults to `object`. A tool that returns `structuredContent` needs a hand-written manifest.
- **Hosted commit status.** `handleStatusMcp` is a stateless MCP endpoint (`initialize`, `tools/list`, `tools/call create_commit_status`) that uses the caller's bearer token as the GitHub token, so the platform holds no GitHub secret. A tenant enables it with one click, which certifies the platform manifest at `<origin>/api/connectors/github-status`, then saves a GitHub token under Connector tokens. Outcomes map as before (`accepted`/`completed` to success, `returned`/`rejected` to failure, anything else to error) and no path ever sends `pending`. The finalizer path is unchanged. The route is served by an Azure Function and by the Vite dev server; the Vercel `api/v1` host does not serve it. The operator must add the deployment host to `WORKFLOW_MCP_ALLOWED_HOSTS`, and `HttpMcpPort` needs https, so the local Vite server cannot dispatch to it.
- **Webhook panel.** `PlatformApi.publicOrigin` (`VITE_PLATFORM_API_ORIGIN`, else the page origin) builds the delivery URL, with a copy button and a GitHub hint: content type JSON, the signing secret shown once, and Pull requests and Pushes. The secret handling is unchanged.
- **PR gate template.** `instantiatePrGate` checks both connectors, creates the draft and one grant per connector node, then runs the normal check. It needs `pull_request_read` (R1), `merge_pull_request` and `issue_write` (R2 or R3) on one connector and `create_commit_status` (R1 or R2) on another, and returns plain-language issues for a missing capability, a wrong risk or a required argument it cannot fill. Only arguments a capability declares are mapped. Grant ids are derived from the command key and node, so a replay completes a half-finished instantiation instead of duplicating it. Merge and issue stay behind approval nodes that disclose the repository and pull request number. The trigger is GitHub-native (`source: github`) and handles `pull_request` events only; a single `inputMap` cannot describe both pull request and push payloads, so push events are ignored. The agent model defaults to `deepseek/deepseek-v4-flash-0731` and may not be in a tenant's catalog; the check then says so and the model can be changed in the editor.
- **Not done.** Ticket 07 (live end-to-end through the UI) needs GitHub, Azure SQL, a public HTTPS URL and a human approver, none of which this change could drive. See `.scratch/mcp-self-serve/results.md`.

## Azure and Vercel deployment (2026-10-06)

Spec: `docs/superpowers/specs/2026-10-06-azure-vercel-deployment-design.md`.

- The SPA is static on Vercel and calls the Azure Functions API cross-origin through `VITE_PLATFORM_API_ORIGIN` (`apps/browser/src/api-origin.ts`, default same-origin). `api/v1/[...path].ts` and `@vercel/functions` are removed.
- The recovery timer reads `%WORKFLOW_DISPATCH_RECOVERY_SCHEDULE%`. It runs every 6 hours; `wake.yml` starts the scaled-to-zero container at minute 5 of those hours so the host runs the missed slot as past-due.
- Hosting moved from Flex Consumption (blocked on the subscription with `ServerFarmCreationNotAllowed`) to Azure Container Apps: `Microsoft.App/containerApps` with `kind: functionapp`, 0.5 vCPU / 1 GiB, 0 to 2 replicas, image from GHCR tagged with the commit SHA. Spec: `docs/superpowers/specs/2026-10-06-container-apps-hosting-design.md`.
- The platform scaler does not cover the Azure Storage Durable provider, so every deploy PATCHes `allowScalingRuleOverride` with `azure-queue` rules on the pinned hub `eaahub` (`infra/scale-rules.jq`). A Bicep PUT resets the override, so the PATCH always follows the Bicep apply. `allowScalingRuleOverride` is rejected on create, which is why it is not in Bicep.
- Key Vault is dropped. A Container Apps `keyVaultUrl` secret must exist when the revision is created, so a first deploy against an empty vault fails. Secrets come from GitHub environment secrets through `@secure()` Bicep parameters and live as Container Apps secrets.
- The migration step now runs before the infra step, because the Bicep apply is the code rollout.
- The managed environment has no Log Analytics destination: the deploy identity is `Reader` on `rg-eaa-shared` and cannot list workspace keys.
- Grafana Cloud: one free stack for both environments (`deployment.environment.name` separates them). Deploys push the four dashboards through the Grafana API; smoke checks that Prometheus, Loki and Tempo accept the query credentials and skips those checks when any Grafana setting is missing.
- `compose.ci.yml` is the first real run of every migration on SQL Server 2022. It found that `database/verify/021_mcp_credential_records.sql` inserted records for a tenant that did not exist; the verify script now creates the tenant inside its rolled-back transaction.
- The runtime contained user `platform_identity_app` cannot read tables directly, so the CI check only proves it connects and holds all seven platform roles (identity, projection writer, studio, connected, workflow browser and worker, governance). The Function App uses one connection string, so the user must hold every role; `create-platform-identity-user.sql` grants them all.
- Durable Functions has no CI emulator. Azurite and a Functions host container are out of scope.
- `tools/smoke` and `tools/sql/ci-init.mjs` are excluded from the root typecheck and lint, like `tools/e2e`.
- `bootstrap.sh` also grants `Reader` on `rg-eaa-shared` and `SQL Server Contributor` on the SQL server, which the spec did not list; Bicep reads Application Insights and the SQL server, and the deploy adds a firewall rule.
- `CLERK_ISSUER` is a per-environment variable because the backend requires it.
- Smoke tier 2 on a production Clerk instance (`pk_live_`) uses the backend session API. That path is unverified; only the development-instance path has been exercised.


## Public demo (2026-10-07)

- Reviewers who are not signed in get a prompt on Studio and Governance and a "Try the demo" button on the landing page. Demo mode is a browser flag in `localStorage` (`threadline.demo.v1`); it never touches Clerk, tenants, SQL or the authenticated API.
- The demo workflow is the real PR gate graph from `buildPrGateGraph`, built over two placeholder certified installations (`packages/workflow/src/pr-gate-demo.ts`). The canvas is read-only and shows every setting; no credential exists in it.
- Starting the workflow calls `POST /api/v1/demo/run`, anonymous, handled in `azure-functions/src/functions/browser-api.ts` before the authenticated transport. The run walks the graph with a deterministic reviewer (`reviewDiff`: hardcoded secrets, injection, removed tests). No model, OpenRouter, Upstash or MCP call is made, so the run costs nothing and cannot spend the owner's credentials. It stops at the human approval node, as the real gate does.
- Optional own-GitHub mode: a visitor token and a `https://github.com/{owner}/{repo}/pull/{n}` address make the server read that pull request and diff from `api.github.com` (fixed host, redirects refused, 8 s timeout, diff capped at 200 000 characters). The token is used in memory for those two calls and is never stored, logged or returned.
- One run per IP address. The key is an HMAC of the address (pepper `DEMO_IP_PEPPER`, optional, with a built-in default) used as a Durable Functions instance id (`demo-<key>`) of the new `demoClaim` orchestration. This needs no SQL migration, no new infrastructure and no new required setting. A rejected token or a malformed request does not consume the run; only a completed run does. A missing or unparseable address, or an unreadable claim store, fails closed with 503.
- The client address is the last `x-forwarded-for` entry, because the Container Apps ingress appends the real peer. Unverified until deployed: if the ingress is ever fronted by another proxy, every visitor shares one address. After a deploy, call the endpoint twice from one machine and expect 200 then 429.
- The visitor's run is kept in `localStorage`, so a reload keeps the result. The server is the only enforcement; clearing storage returns "already used".
- Governance in demo mode is `demoSource` (`apps/browser/src/governance/demo-source.ts`): one workspace, one group, and the visitor's run shown in the overview, workflow table, pending approval, logs and trace. Decisions are disabled and the assistant (a model call) is hidden because the source is marked `fixture`.
- Server telemetry stays on: the demo emits `demo.runs` (source, outcome) and the `demo.run` event. Neither carries a tenant, an address or a token, and no existing metric or dashboard query changes.
- Not done: a race between two simultaneous first requests from one address can start two orchestrations; the second is rejected only if the first is already visible. The cost of that is one extra free simulated run.

### Demo reviewer model call (2026-10-07)

- The reviewer step makes exactly one call to `PR_GATE_DEFAULT_MODEL` (DeepSeek V4 Flash on OpenRouter) when the server has `DEMO_OPENROUTER_API_KEY`. Without the key, or when the call fails, times out or returns an answer `parseVerdict` rejects, the run uses the deterministic `reviewDiff` verdict, whose summary says no model was called. The call happens after the once-per-IP claim, so a visitor cannot repeat it; a rejected token or malformed request still makes no call.
- The key is a server environment secret read only by `demoReviewer` (`packages/workflow/src/pr-gate-demo-review.ts`). It is not a tenant connection, so `HttpModelPort` and `OpenRouterConnectionCrypto` are not used. Owner step: create a dedicated OpenRouter key with a low credit limit, then set it as a Container Apps secret and plumb it in `infra/`; neither is done here.
- Hard bounds: diff clipped to 40 000 characters, 700 completion tokens, 20 s timeout, one attempt, strict JSON schema (`REVIEW_SCHEMA`), redirects refused.
- The diff is attacker-controlled. It travels only as JSON data in the user message, the system prompt tells the model to ignore instructions inside it, and the output is validated and clamped (lengths, finding count, risk enum) before use. The verdict is advisory: the run never acts on the pull request and still stops at human approval.
- Telemetry reuses `observeModelCall`: a `model.call` event and `gen_ai.*` metrics labelled `tenant_id` = `DEMO_TENANT_ID` and `feature` = `demo`. Neither carries the diff, the key or the model's text.

### Demo run store (2026-10-07)

- Migration `022_public_demo_runs` adds a `public_demo` schema (the existing `demo` schema is migration 004's connected-platform scenario tables and is not reused). It holds `definitions` (one row per workflow revision, keyed by the SHA-256 of the canonical demo graph) and `runs` (one row per demo run, with the run JSON and the HMAC of the visitor's address). It has no tenant, identity, group or `workflow.records` rows, so no tenant or group read can reach it and nothing in it can be mistaken for a real tenant's data. The demo tenant stays the constant `DEMO_TENANT_ID`, used as the telemetry label.
- Access is only through three `EXECUTE AS OWNER` procedures granted to the existing `platform_workflow_browser` role (the runtime contained user already holds it, so no bootstrap or role-count change): `write_run`, `read_own_run`, `purge_runs`. No table grant exists; `database/verify/022_public_demo_runs.sql` checks this.
- Bounds: 262 144 bytes per JSON column, valid JSON, fixed source and branch values, and a hard cap of 5 000 runs (`write_run` fails with 50005 when full, which the handler treats as a storage failure). Retention is 30 days: the `demoPurge` timer (daily, 04:30 UTC, `azure-functions/src/functions/demo-purge.ts`) calls `purge_runs`, which also removes definitions no run references. Timers only fire while the API is awake; the six-hourly wake-up workflow covers that.
- `handleDemoRun` saves the run after the claim. A storage failure is reported and does not fail the run or release the claim. With no `AZURE_SQL_CONNECTION_STRING` nothing is saved, as before.
- What is stored per visitor: the run JSON, which for the optional own-GitHub mode includes the pull request owner, repo, title, author and the reviewer's findings, plus the address hash, for 30 days. It never includes the GitHub token, the key, or the diff.
- Verified against SQL Server 2022 in a local container (migrate twice, verify, a cap rejection and a store round trip); CI repeats migrate and verify. Not applied to the live database.
