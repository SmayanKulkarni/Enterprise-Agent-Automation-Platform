# Decide memory correction, retention, and operator controls

Type: wayfinder:grilling
Status: resolved
Blocked by: 01, 02, 03

## Question

How do correction, withdrawal, deletion, expiry, legal hold, and source invalidation propagate from Run History or user input to Run Summaries, agent-authored memory, imports, indexes, and caches? Decide what operators can inspect or correct, what remains as immutable evidence, and how the existing memory lifecycle contracts are reused in durable storage.

## Decisions

- A correction creates a new immutable item linked to its predecessor and withdraws the predecessor from future retrieval. It never rewrites Run History, a Run Summary, or a prior retrieval result.
- A tenant admin may correct, withdraw, place or release a legal hold, and request deletion. Operators may inspect redacted status, provenance, retrieval, and failure metadata but cannot change memory.
- Withdrawal, expiry, source invalidation, and deletion requests immediately make an item ineligible in the workflow-service recheck and enqueue an idempotent vector delete or metadata update.
- Memory expires 90 days after promotion unless a tenant admin sets a shorter expiry or applies a legal hold. A hold prevents physical deletion but does not re-enable a withdrawn item.
- Deletion removes the hosted vector text and embedding after the legal-hold check. The SQL workflow ledger retains only the immutable, redacted lifecycle receipt and source reference required for audit; Operational Memory content is not retained in SQL.
- Invalidated source evidence withdraws every derived summary and item. Existing Run History and recorded retrieval results remain immutable evidence, while cache entries are invalidated immediately and may never be used without a fresh eligibility check.
- Import revocation is prospective and uses the same eligibility check. It does not delete source memory or alter earlier runs.
- Every lifecycle action, provider retry, and final failure is audited with actor or system principal, request ID, item ID, predecessor when present, timestamps, reason, and provider outcome. The existing memory lifecycle command vocabulary is reused; it is exposed through workflow-specific, tenant-scoped commands and projections.
