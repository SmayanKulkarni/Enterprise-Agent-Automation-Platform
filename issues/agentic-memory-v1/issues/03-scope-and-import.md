# Decide memory scope and import authority

Type: wayfinder:grilling
Status: resolved
Blocked by: 01

## Question

How is the agreed same-Workflow-Definition default represented across published revisions, and when may another Workflow Definition consume a record? Specify tenant and optional user or Agent ownership, and how an explicit Memory Import is granted, pinned, revoked, and audited for new agent-authored records while preserving tenant isolation and the accepted Run Summary boundary.

## Decisions

- The default scope is the server-derived pair of tenant ID and stable Workflow Definition ID, deliberately excluding the published revision.
- Each item retains its producing revision and source provenance; callers never supply the source tenant or default scope.
- An optional user or Agent owner narrows eligibility to the same validated owner on the retrieving run. Unowned task facts remain definition-scoped.
- No scope or import crosses a tenant boundary.
- A tenant admin grants an import by publishing an immutable target-revision attachment to one source Workflow Definition. It is a live attachment, not a source-memory snapshot.
- An active import exposes eligible new and existing Run Summaries and agent-authored items from its source; the target cannot mutate source records and source owner filters still apply.
- Only a tenant admin grants or revokes an import. Revocation is prospective; prior retrieval results remain immutable Run History.
- Grant, revoke, and retrieval are audited with import, actor, server-issued request ID, timestamps, target revision, source definition, and any revocation reason. The request ID is reused for retries; the promotion fingerprint remains the duplicate-item guard.
