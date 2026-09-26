# Additive agentic memory for Diagram Workflow V1

Type: wayfinder:map
Status: resolved

## Destination

An accepted, implementation-ready design and ordered build plan for adding agentic memory to Diagram Workflow V1. It covers both the already planned Run Summary recall and new agent-authored facts or preferences, with data contracts, authority, lifecycle, workflow integration, verification, and rollout gates.

## Notes

- This is planning only. Preserve the existing workflow architecture and the implementation sequence in [Diagram Workflow V1](../diagram-workflow-v1/README.md).
- Apply the accepted [workflow decisions](../../docs/diagram-workflow-v1-decisions.md), the [glossary](../../CONTEXT.md), and the [Model and Operational Memory issue](../diagram-workflow-v1/05-model-memory.md). New choices must extend those contracts rather than silently replace them.
- The current graph compiler accepts a `memory` node with `limit`, `maxChars`, and Node policy. Uncommitted workflow code now includes a Run Summary pipeline and Azure SQL JSON storage, but no agent-authored memory runtime; the memory package's `RelationalMemoryStore` is still in-memory. Treat this plan as additive to the existing workflow delivery.
- Apply the user-set [agentic memory extension constraints](../../docs/diagram-workflow-v1-decisions.md#agentic-memory-extension-constraints). The open tickets determine the precise contracts within them.
- Use `$ponytail` when designing implementation details. Keep `CONTEXT.md` a glossary and put any accepted workflow implementation decision in `docs/diagram-workflow-v1-decisions.md`.
- Local Markdown tickets live in this directory's `issues/` folder. An open ticket with no unresolved `Blocked by` entries is on the frontier. Claim a ticket by setting `Status: claimed` before working it; record its answer and set `Status: resolved` when done.

## Decisions so far

- [Research durable semantic search within the current stack](issues/05-durable-search-capabilities.md): Azure SQL has an exact vector path, but its memory-store recommendation was superseded by the user's no-SQL direction.
- [Define the agentic memory record boundary](issues/01-memory-record-boundary.md): V1 admits source-linked task facts and explicitly stated user preferences as immutable derived memory items.
- [Decide who can write and promote memory](issues/02-write-and-promotion.md): the server validates untrusted, source-linked proposals and automatically promotes the admitted types idempotently; invalid and terminally failed proposals remain non-retrievable.
- [Decide memory scope and import authority](issues/03-scope-and-import.md): default scope is tenant plus stable Workflow Definition ID; tenant-admin-published, live imports expose eligible source records to a target definition while active and are audited and prospectively revocable.
- [Research hosted vector memory and concurrent access](issues/09-hosted-vector-and-concurrency-research.md): Use Upstash Vector as the initial tenant-partitioned hosted service, with asynchronous idempotent writes and bounded indexed reads.

## Resolved decisions

- [Agentic Operational Memory integration spec](issues/00-agentic-memory-integration-spec.md) consolidates the resolved tickets into a ready-for-agent build contract, including the existing backend and browser seams and the frontend views still to design and implement.
- Memory nodes retrieve only explicit, bounded, redacted, source-linked evidence; unavailable memory never changes the Workflow Run outcome.
- Corrections create successors, withdrawals and source invalidations remove future eligibility, and lifecycle actions remain auditable immutable evidence.
- Upstash Vector is the selected hosted Operational Memory backend. Azure SQL retains Run History and a non-content lifecycle ledger.
- The authenticated Studio remains the frontend boundary: real projections and commands cover imports, lifecycle visibility, and redacted operator/admin controls; no browser receives vector text, embeddings, or credentials.
- Vercel provisioning needs a valid existing project link before a real Upstash integration can supply production environment variables. This is an operational deployment prerequisite, not a reason to add a mock.

## Ready for implementation

- [Authenticated Studio frontend integration](issues/10-studio-memory-frontend-integration.md) specifies the remaining browser controls and redacted projections against the implemented runtime contract; status: ready-for-agent.
- [11 — Configure Operational Memory in Studio](issues/11-configure-operational-memory-in-studio.md), [12 — Inspect Operational Memory in Studio](issues/12-inspect-operational-memory-in-studio.md), and [13 — Govern Operational Memory in Studio](issues/13-govern-operational-memory-in-studio.md) are independent implementation tickets with no blocking edges.

## Out of scope

- Rebuilding the diagram editor, compiler, durable run engine, browser transport, or existing memory package from scratch.
- Cross-tenant memory sharing, model training, autonomous workflow rewriting, and arbitrary agent-selected code execution.
