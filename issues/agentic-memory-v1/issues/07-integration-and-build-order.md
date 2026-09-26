# Lock the additive integration and build order

Type: wayfinder:grilling
Status: resolved
Blocked by: 02, 03, 04, 05, 06

## Question

Given the resolved memory contracts, what are the exact additions to published graph configuration, workflow activities, post-run summary generation, hosted vector writes and queries, browser projections, and current package seams? Order the implementation behind Diagram Workflow V1 dependencies, name the smallest independently reviewable slices, and identify what can be reused unchanged.

## Decisions

- Use Upstash Vector as the initial hosted vector backend: it is the top relevant Vercel Marketplace discovery result and supplies a free, namespaced REST vector store. Pinecone is retained only as a benchmark fallback, not a second production path.
- Keep Azure SQL as immutable Run History and lifecycle/audit ledger only. Operational Memory text and embeddings live in the hosted vector store; the ledger stores no recoverable memory content.
- Add a `HostedMemoryPort` beside the existing `MemoryPort`: `upsert`, bounded `query`, and `remove` use server-only `UPSTASH_VECTOR_REST_URL` and `UPSTASH_VECTOR_REST_TOKEN`, tenant namespace, deterministic item ID, and server-derived metadata. No provider SDK or browser credential is added.
- Replace `AzureEmbeddingMemoryPort.rank`, which currently embeds and scans every candidate on each read, with one query embedding and one provider `topK` request. The service rechecks eligibility after the response.
- Add immutable `memory-item` and `memory-lifecycle` workflow records for identity, source provenance, state, retry receipt, predecessor, and audit data. Add worker activities for promote, query, withdraw, and provider retry; keep I/O out of orchestration replay.
- Extend the existing post-run summary activity to promote a validated Run Summary through the same port. Agent nodes submit bounded proposals to the promotion activity; no Agent gains direct vector credentials.
- Compile the existing Memory node unchanged (`limit`, `maxChars`, and policy). Its runtime output becomes a bounded `memory` object with status, untrusted items, and provenance. Agent prompt assembly consumes only that explicit node output.
- Replace run-pinned imports with admin-published, target-revision-pinned source-definition attachments. Add a revoke command; evaluate imports at retrieval time so new eligible source records are visible and revocation is prospective.
- Wire the authenticated Studio to actual API projections: retain the existing live import panel, change it to source-definition import/revocation, add a read-only Memory panel for status, provenance, expiry, failures, and retrieval history, and expose admin lifecycle controls without rendering memory text or secrets.
- Build in reviewable order: record/port contracts and tests; provider adapter and retry tests; promotion and lifecycle activities; retrieval and import migration; browser projection and controls; live quota/latency certification. Existing graph compiler, durable traversal, Run History, auth, browser transport, and summary source validation are reused.
- Vercel provisioning is not complete: `vercel link --yes` cannot derive a valid project name from this directory. Do not create an unrelated project or add provider credentials until the existing project is linked by name; the frontend remains API-wired and reports provider readiness rather than simulating it.
