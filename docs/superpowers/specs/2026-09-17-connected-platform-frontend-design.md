# Connected platform frontend design

Status: design approved in chat; written specification pending review
Scope: complete browser-facing coverage of the current platform capability set

## Goal and acceptance boundary

Extend the existing React/Vite browser app into a functioning interface for
Solution Studio, Governed Catalog, Operations Control Plane, and both reference
solutions. A completed screen reads authorized backend state, submits supported
actions through the owning backend command, and shows the committed result and
its evidence after reload. Both reference journeys must complete success and
denial/recovery paths with actual backend state changes. Provider activity counts
as live only when backed by a verified provider receipt; local and showcase
fixtures retain their `fixture` label.

Coverage means every `browser.v1` read route and every safe human-facing owner
operation has an intentional page or action. Internal primitives such as secret
material access, provider adapter calls, timer callbacks, and raw event ingestion
remain service-only; their safe status, decision, and receipt evidence is visible
through projections. A coverage ledger records that classification for each
operation and prevents a generic disabled button from counting as coverage.

## Existing baseline and decision

The app already uses Clerk, Tenant selection, Fluent UI, and the same-origin
`browser.v1` transport. It currently reads five synthetic collections. The
local/Vercel host constructs fixture projections, registers no command handlers,
and returns `501` for events. Existing Technical Implementation browser handlers
run fixture logic; Vendor handlers return canned states. These are useful
fixtures but do not satisfy the connected-product goal.

Keep the existing app and transport. Replace fixture projections with safe
projections from the owning modules, wire named command handlers, and add durable
state before making actions appear available. A separate frontend would repeat
authentication and contract work; a visual-only expansion would leave the
requested workflows unimplemented. Follow the existing surface-first navigation
and Case-centric operational drill-down.

## Architecture and data flow

1. The browser gets a short-lived Clerk session token from Clerk-managed memory.
   It sends the token only in a Bearer header to the same-origin API. The API
   authenticates the current session and Tenant membership on every request.
2. A read returns a Tenant-authorized `browser.v1` projection. The response
   includes classification, freshness, completeness, redaction, version or
   generation, and a projection watermark where applicable. Evidence visibility
   is checked separately from permission to act.
3. A human action sends an owner-specific command through
   `POST /api/v1/tenants/:tenantId/commands/:owner/:name`, using the existing
   envelope/media type plus `expectedVersion`, `If-Match`, idempotency key, and
   correlation ID. The owner checks fresh authority and approval, validates
   arguments, commits its durable facts, and returns a receipt.
4. The UI shows submission, owner receipt, and projection catch-up as distinct
   states. It refreshes the affected object after a command. Events may prompt
   refresh but never replace the authorized projection. Sequence gaps force a
   targeted reload; reconnect also reloads.
5. The server composition retains state across requests and restarts. Case
   execution history and Tenant facts/projections use the repository's ratified
   ownership boundaries. A per-request object or function-instance memory map
   is not durable state. Fixture mode remains isolated and unmistakably labeled.

The client uses one typed API layer rather than per-page `fetch` code. DTOs and
command schemas are derived from or checked against the shared contracts.
Existing Fluent UI components provide layout, controls, focus behavior, and
status messaging; domain components are shared only where the workflow truly
shares behavior (Case timeline, evidence badge, command confirmation, receipt).

## Navigation and pages

| Area | Pages and principal actions |
| --- | --- |
| Entry | Sign-in, Tenant picker, guided journey index, environment/readiness banner |
| Solution Studio | Package list/detail, version authoring, artifact diff, Agent Team/workflow/skill views, validation, simulation, evaluations, submit for review |
| Governed Catalog | Discover, trust/provenance detail, independent review queue, installation configuration, readiness, activation/upgrade/quarantine/retirement history |
| Operations | Task overview, Cases, Case detail, interventions, capabilities/providers, authority decisions, effects/reconciliation, memory, evaluations, improvements, deployments, cost, audit/evidence |
| Technical Implementation | Agreement and Customer Environment intake, discovery/plan, customer information, validation, approval, provider effects, production handoff |
| Vendor Risk and Access | Assessment intake/evidence/decision, linked Access Grant request, approval, provisioning, expiry/revocation/reconciliation |
| Demonstration evidence | Run index/detail, step outcomes, live-versus-fixture labels, evidence manifest, reset and residual report |

The persistent context bar shows Tenant, environment, relevant package/version
or Case, and data classification. Deep links name a specific authorized object;
the server independently checks every load. Inaccessible objects use
non-enumerating errors. A Case detail retains correlation and causation through
stage, assignment, intervention, effect, receipt, evaluation, and cost links.

## Read API coverage

All thirteen collection routes support authorized list and object detail reads,
with stable identifiers and consistent pagination/filtering. The current route
accepts UUID detail IDs while fixture records use readable IDs; the contract
must settle on one canonical opaque ID format before linking details.

| Collection | UI destination and required result |
| --- | --- |
| `cases` | Case list/detail: state, package pin, generation/version, timeline, outcome |
| `interventions` | Assigned queue/detail: responder, digest, deadline, decision history |
| `capabilities` | Capability/adapter availability, health, quota and scope-safe metadata |
| `installations` | Package/provider installation, version, configuration references, readiness |
| `memory` | Authorized provenance, retrieval explanation, status, holds, validated experience |
| `evaluations` | Ledger, comparison, gate results, supporting evidence |
| `improvements` | Candidate state, shadow/canary metrics, promotion or rollback evidence |
| `packages` | Draft/published versions, artifacts, digest, trust and provenance |
| `operations` | Effects, attempts, receipts, checkpoints, alerts, audit and cost joins |
| `deployments` | Manifest, checks, lease, restore and teardown records |
| `readiness` | Package/provider/environment/handoff checks and blocked dependencies |
| `vendor-assessments` | Evidence, outcome, version, expiry and supersession |
| `access-grants` | Assessment pin, canonical request, approval, provider effects, expiry/revocation |

`GET /session` and `GET /tenants` power bootstrap and Tenant switching.
`GET /events` carries Tenant-scoped change hints with sequence/watermark; the
browser refetches projections. If event delivery is unavailable, manual and
post-command refresh still work. Pagination cursors are Tenant-bound and
server-generated. The UI never fabricates full completeness from missing rows.

## Command coverage by owner

The implementation ledger gives each command an exact route name, request and
response schema, authority/approval rule, affected projection, and UI entry.
The human-facing command set covers:

| Owner | Human workflow |
| --- | --- |
| Identity/authority | Tenant membership and scoped approval administration; approval/denial explanations. Self-approval and wrong-plane authority fail. |
| Lifecycle | Author/resolve/validate package; submit and independently approve/sign/publish; install, activate, upgrade/rollback, quarantine, retire. |
| Case/runtime | Create/submit/start/cancel/reopen Case; provide information, approve/reject intervention; operator pause/resume/retry/reconcile/compensate where the owner supports it. System timers and stage transitions have evidence views, not manual buttons. |
| Gateway | Install/validate/disable/reauthorize/rotate/revoke provider installation or credential reference; reconcile an uncertain effect. Secret values and raw invocation arguments never become browser fields. |
| Memory | Correct, export, hold/release, delete/restore with exact manifest, review/promote validated experience. |
| Evaluation/improvement | Create/evaluate candidate, start shadow/canary, promote or rollback only against current gates and approval. |
| Deployment/portfolio | Inspect/deploy/restore/teardown with exact manifest and lease authority; start/reset authorized demonstration run; publish and score evidence. |
| Vendor solution | Start/decide/supersede assessment; request/approve/provision/revoke/expire/reconcile grant. |

The server does not expose arbitrary internal method invocation through the
generic route. A named registry maps each accepted command to one owning
operation. Commands that lack durable implementation or required provider
configuration remain unavailable with a specific prerequisite, rather than
returning an invented success state.

## Required end-to-end journeys

### Technical Implementation

An accepted agreement creates a Case for a Customer Environment. Discovery and
Security specialists produce typed evidence in parallel; the plan view shows
their join and a Validation-driven revision. A customer responder supplies
missing information, then an independent approver authorizes the exact change.
Gateway-mediated Graph/SQL/Blob/Boards effects display intent, attempt,
provider-safe receipt or unknown-outcome checkpoint. The Case ends with a
readiness handoff containing tests, open actions, residual risk, and approval.
The failure branch includes unavailable access or provider uncertainty, an
operator recovery, and a reset/residual report.

### Vendor Risk and Access

An assessment collects versioned evidence and an independent risk decision.
An Access Grant pins a current approved assessment version and an exact
subject/resource/privilege/purpose. Its approval displays the canonical request
and separation rule. Graph/Jira effects show real receipts and idempotent
duplicate behavior. Expiry or manual/policy revoke follows the same command
path; `revocation-pending` remains visible until both effects reconcile. A
superseded assessment or stale approval blocks new provisioning and explains
the next required action.

Both journeys retain a success path and at least one denial, duplicate, stale,
provider failure, reconciliation, and reset path in the evidence index. The
existing demonstration rubric and run manifest define the proof fields.

## Interaction and failure behavior

- Lists have useful empty, loading, stale, partial, redacted, and unavailable
  states. A partial projection never enables an action requiring complete facts.
- Action panels show the exact target/version, authority and approval
  prerequisite, consequence, compensation or rollback, and canonical effect
  preview before submission. High-risk actions require an explicit confirmation.
- A stale version refreshes the object and preserves unsent form input. An
  identical retry uses its original idempotency key and receipt; a conflicting
  retry stops with a conflict. An unknown provider outcome shows reconciliation
  as the next step and never reports success prematurely.
- Tenant change, logout, or revoked membership clears Tenant-scoped cached
  views and subscriptions. Foreign identifiers reveal no record existence.
- All key paths work by keyboard, have named controls and live status text, and
  remain usable at mobile widths. Animation is subtle and respects reduced
  motion; it is never the only indication of state.
- Cost is marked estimated/final/unknown/shared. Unknown is not shown as zero.
  Every evidence link retains classification and redaction metadata.

## Delivery workstreams and dependencies

This design is a program umbrella; each workstream gets its own implementation
plan and acceptance run so that the full platform is not treated as one ticket.

1. **Contract ledger and durable serving:** inventory current routes/methods;
   settle IDs/DTOs; wire named owners, authorization, persistence, projections,
   receipts and event hints. Prove one command survives process restart.
2. **Browser foundation and package path:** typed client, deep links, state
   handling and accessibility; Studio validation through Catalog activation.
3. **Shared Case and Technical journey:** Case timeline, intervention/effect
   views, real Technical Implementation success/recovery/handoff.
4. **Vendor journey:** linked assessment/grant flows, provider receipts,
   expiry/revocation and stale/denial handling.
5. **Remaining control surfaces:** gateway/credential status, memory,
   evaluation/improvement, deployment, cost, audit, portfolio evidence.
6. **Live demonstration verification:** configured providers, both journeys,
   failure/reconciliation/reset, manifest links and residual scans.

Workstream 1 is the prerequisite for actionable pages. Workstreams 3 and 4
reuse the same Case, authority, receipt, and evidence components. Fixture data
can support development and deterministic checks but cannot close workstream 6.

## Verification and completion

The coverage ledger has no unassigned browser route, owner command, or
human-facing backend feature. For every action, check permitted, denied,
cross-Tenant, stale, duplicate-identical, duplicate-conflicting, and partial
projection cases as applicable. Test a process restart between command and
read. Browser journey tests exercise both reference solutions from sign-in to
outcome, including reload and recovery. Accessibility checks cover keyboard,
focus, labels, errors, and narrow screens.

A completed run produces Case timelines, decision and approval evidence,
effect intent/attempt/receipt/checkpoint, evaluation and cost links, exact
package/install pins, provider-safe identifiers, classification labels,
reset/teardown report, and a manifest whose links resolve. Live claims require
independently verified live receipts; fixture and recorded evidence are labeled
as such. No UI-only action or synthetic success satisfies completion.
