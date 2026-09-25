# 12 — Inspect Operational Memory in Studio

**What to build:** A workflow operator can understand provider readiness, redacted item lifecycle, source-definition Memory Imports, and the exact items and imports used by a Memory node on a Workflow Run, without receiving stored memory content or another workflow's metadata.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] The authenticated view distinguishes disabled, not-configured, ready, and unavailable provider states with useful tenant-administrator or deployment-operator guidance; unavailable explains that Workflow Runs continue without recalled context.
- [x] Each item shows its available type, lifecycle and vector states, source ID and digest, producing revision, owner-scope flag, predecessor, promotion time, expiry, hold, and safe failure category. Missing optional values have clear labels; pending and failed items are identified as non-retrievable.
- [x] Retrieval receipts show Workflow Run and Memory node IDs, status, item IDs, Memory Import IDs, and safe failure state. Empty and unavailable retrievals are explicit. Receipts are scoped to the selected published or stable Workflow Definition.
- [x] Memory Import entries show source stable Workflow Definition, exact target revision, and active or revoked state. Copy explains that revocation affects future retrieval only.
- [x] Loading, empty, request-failure, tenant-switch, definition-switch, and sign-out behavior prevents stale or cross-tenant metadata from remaining visible. Operator access remains read-only.
- [x] Browser projections and rendered output exclude stored memory text, embeddings, provider credentials, owner identity, and protected Run History input. Any provider exception currently exposed as a free-form failure is normalized to a safe category at the projection boundary.
- [x] Focused view and authenticated browser-to-Workflow-Run tests prove the redacted item and retrieval provenance behavior, including an imported item and an unavailable provider. The view is keyboard and screen-reader accessible.
