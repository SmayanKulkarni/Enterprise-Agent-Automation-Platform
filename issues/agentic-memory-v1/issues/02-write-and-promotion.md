# Decide who can write and promote memory

Type: wayfinder:grilling
Status: resolved
Blocked by: 01

## Question

How does an Agent propose a memory item, and which server validation and authority gates make it automatically retrievable? Define schema validation, source eligibility, redaction, deduplication, conflicting claims, failures, retries, and the boundary between model proposal and trusted server write. Identify any record type that cannot safely use the agreed automatic promotion rule.

## Decisions

- An Agent submits only an untrusted, bounded proposal: admitted type, candidate text, exact source ID and digest, supporting excerpt, and a source subject for a preference.
- The server derives tenant, Workflow Definition, scope, retrievability, and identity from the completed run. An Agent cannot set any of them.
- Promotion requires a valid schema, immutable validated source in the same tenant and definition, matching source digest, and an exact supporting excerpt.
- Secrets are redacted before validation; a proposal or required excerpt changed by redaction is rejected.
- The fingerprint is deterministic over the derived scope, type, source ID and digest, optional subject, and normalized redacted text. A duplicate fingerprint is a successful no-op.
- A predecessor link is valid only within the same scope and retains both immutable items for lifecycle resolution.
- The server alone promotes an item and schedules its vector upsert. Valid V1 items become retrievable automatically; no manual promotion exists.
- Invalid proposals are terminal and visible to operators. Transient validation, embedding, or vector-write failures retry the idempotent activity three times, remain non-retrievable on final failure, and do not alter the completed run.
