# Enterprise Agent Automation Platform

This context defines the governed objects that turn a user-authored workflow into a durable, tenant-scoped automation.

## Workflow authoring

**Workflow definition**:
An immutable, versioned executable graph compiled from a diagram and pinned by every run.
_Avoid_: Canvas, diagram, flow

**Extension**:
A tenant-provided MCP server, reached through a Connector Installation and exposing schema-bound Capabilities.
_Avoid_: Plugin, arbitrary code, managed connector

**Capability**:
A named, schema-bound operation exposed by an installed Extension and authorized for a tenant.
_Avoid_: Function, action

**Agent tool**:
A Capability, or the Operational Memory search and save pair, attached to an Agent by a tool edge that the model may call, one call at a time, during that Agent's step; it is not a step in the flow.
_Avoid_: Plugin, chain step, parallel call

**Branch join**:
Two or more flow connections entering one node, such as both Condition branches leading to the same End; only one path runs in a Workflow Run.
_Avoid_: Parallel merge, fan-in

**Connector installation**:
A tenant-admin-owned binding of an Extension to its credentials, certified Capability Manifest, network route, and health state.
_Avoid_: Login, integration setup

**Connector token**:
The secret an administrator pastes for a Connector Installation. It is stored sealed for that tenant and installation, replaces the server environment variable while active, and is never shown again.
_Avoid_: API key, password

**Hosted status connector**:
The Extension the platform itself serves to publish the `workflow/pr-gate` commit status. It uses the tenant's Connector Token as the GitHub token and holds no GitHub secret of its own.
_Avoid_: Managed connector, status server

**Private connector agent**:
A tenant-operated relay inside the tenant network that invokes a private Extension.
_Avoid_: VPN, public proxy

**Capability manifest**:
The immutable, admin-certified schema and risk record for the Capabilities available from one Connector Installation.
_Avoid_: Live discovery, MCP metadata

**Capability grant**:
The explicit permission that makes an installed Capability available to a particular Workflow Definition node.
_Avoid_: Prompt instruction, implied access

**Risk tier**:
An administrator-assigned effect classification for a Capability; an uncertified Capability is external, potentially destructive, and approval-required.
_Avoid_: MCP annotation, model judgment

## Durable operation

**Run outcome**:
The way a Workflow Run ended. `completed` and the four non-failure outcomes (`rejected`, `expired`, `cancelled`, `superseded`) are deliberate; only `failed` and `unknown-outcome` count as failures. Governance success rate is completed runs over runs that were not rejected, expired, cancelled or superseded.
_Avoid_: Final state, result

**Judgment step**:
A workflow step that asks a decision model up to 16 typed questions about the same mapped state in one call, and records each answer with its probability, confidence, and band, plus an overall band; it produces no text and takes no action.
_Avoid_: Decision node (Decision means an approver's outcome), classifier

**Decision record**:
What an approver decided and saw: outcome, optional reason, approver, time, binding digest, and the disclosed facts, kept in the run after the decision.
_Avoid_: Approval log, audit note

**Run label**:
The text a trigger's `label` template resolves to at admission, used as the run's title in the approvals inbox and Run History.
_Avoid_: Run name, title

**Subject**:
The thing a webhook run is about, named by a trigger's `subjectKey` fields and versioned by its `subjectVersion` field (for example a pull request and its head SHA). A newer event for the same subject supersedes the run still in flight.
_Avoid_: Target, resource

**Finalizer**:
An MCP step attached to the Trigger by a finalizer edge that runs once when a Workflow Run ends in any status, without approval, and never changes the run's status.
_Avoid_: Cleanup hook, on-exit

**Evidence completeness**:
Whether everything an Agent was shown was whole. Truncated tool output fails the Agent by default; if allowed, the output is marked `evidenceComplete: false` and approvers see `evidence: partial`.
_Avoid_: Confidence, quality

**Capability variant**:
A Capability in a manifest that calls an underlying tool with fixed arguments (`tool`, `fixed`) so the model cannot choose them.
_Avoid_: Overload, alias

**Run history**:
The immutable, ordered evidence of one Workflow Run, including node attempts, model requests, effects, approvals, and results.
_Avoid_: Memory, logs

**Operational memory**:
Authorized, provenance-bearing information retained for retrieval by later runs of one Workflow Definition; it is distinct from a Run History.
_Avoid_: Chat history, logs

**Model settings**:
The tenant administrator's explicit selection of the summary model, its optional fallback, and the embedding provider and model used for Operational Memory.
_Avoid_: Environment default, model allowlist

**Embedding profile**:
The provider and model that produced a stored vector; retrieval considers only vectors from the tenant's current profile.
_Avoid_: Fallback embedding, mixed index

**Run summary**:
A source-linked condensation of Run History.
_Avoid_: Memory, audit record

**Agent-authored memory item**:
A source-linked task fact or explicitly stated user preference proposed by an Agent for Operational Memory.
_Avoid_: Instruction, inferred trait, Run History

**Run Outcome Record**:
The Run Summary written for a completed run: what the run concluded about its subjects, composed on the server from findings that each quote an exact excerpt of the run input or a node output. A run with no reusable conclusion writes none. It is stored under the `run-summary` item type.
_Avoid_: Process log, transcript summary

**Subject key**:
A normalized entity key such as `npm:zod` or `repo:acme/api` carried by a memory item, at most three per item, proposed by the model and validated by the server. Retrieval and Consolidation scope by it.
_Avoid_: Tag, topic, free-text label

**Consolidation**:
The decision made when a pending memory item is promoted: add it, treat it as a duplicate of a promoted item, or let it supersede one. Duplicates are found deterministically by score, ambiguous cases go to the summary model, and a failure always adds.
_Avoid_: Merge, dedupe job, review

**Supersession**:
A promoted memory item withdrawn because a newer item about the same subject replaced it. The older item stays in SQL with a link to its successor and its vector is removed; it is never hard-deleted and a legal hold blocks it.
_Avoid_: Deletion, overwrite

**Memory import**:
An explicit Workflow Definition attachment that makes a source-linked Run Summary available to another workflow's Memory node.
_Avoid_: Shared tenant memory, implicit recall

**Approval**:
An administrator's authorization of one exact external effect, bound to its workflow version, capability, target, and arguments digest.
_Avoid_: Permission, review

**Disclosed argument**:
An argument of the effect an Approval guards that the workflow author lists on the Approval node so the approver reads its exact value; it is the value the effect will receive, bound by the arguments digest.
_Avoid_: Review note, summary field

**Node policy**:
The versioned bounds for one executable node.
_Avoid_: Prompt, model preference

**Published model policy**:
The versioned inference settings for an Agent node.
_Avoid_: Prompt text, model preference

**Trigger**:
An event that starts a Workflow Run.
_Avoid_: Connector callback, schedule

**Evidence retention**:
The tenant policy that controls the lifetime of Run History and derived operational logs.
_Avoid_: Backup, memory retention

## Governance

**Tenant group**:
An entity that owns several workspaces (tenants). A workspace belongs to at most one group.
_Avoid_: Organization, folder, parent tenant

**Group admin**:
A user who administers a tenant group and therefore holds real admin rights in every member workspace, materialized as memberships.
_Avoid_: Super admin, owner

**Evidence plane**:
Azure SQL as the exact source of truth for run counts, spend, approvals and membership.
_Avoid_: Metrics store

**Telemetry plane**:
Traces, metrics and logs pushed over OTLP; approximate; used for latency, error rates, logs and traces.
_Avoid_: Audit trail

## Public demo

**Demo workspace**:
A browser-only mode, entered from the landing page or the sign-in prompt, that shows the PR gate workflow read-only with no credentials and a Governance view of the visitor's own demo run.
_Avoid_: Sandbox, trial, fixture workspace

**Demo run**:
The single simulated PR gate run a visitor may start per IP address. A deterministic reviewer replaces the model and the run stops at the human approval.
_Avoid_: Test run, free run
