# Set acceptance and rollout gates for agentic memory

Type: wayfinder:grilling
Status: resolved
Blocked by: 07

## Question

What observable tests and release gates prove that source-linked memory is durable, relevant, scoped, revocable, safe after replay, and correctly surfaced in the existing authenticated browser run journey? Define fixture versus live evidence, migration and backfill rules, failure visibility, and the threshold for enabling the feature without changing existing Workflow Run outcomes.

## Decisions

- Unit and contract tests cover proposal validation, redaction rejection, deterministic duplicate promotion, predecessor correction, owner filtering, source invalidation, expiry, legal hold, withdrawal, and provider retry exhaustion.
- Workflow tests prove that a Memory node returns only same-definition or actively imported items, never crosses tenants or owners, produces empty and unavailable results safely, preserves a completed run on provider failure, and never performs retrieval from an Agent node implicitly.
- Replay tests execute each promotion and lifecycle activity more than once and assert one vector item, one ledger outcome, and no changed Run History. Import revocation must prevent only future retrieval.
- Browser acceptance uses the authenticated API, not fixture data: an admin can create and revoke a source-definition import and perform lifecycle actions; an operator can see redacted memory status and provenance; neither view receives embeddings, raw memory text, or credentials.
- Live certification requires an Upstash Vector tenant namespace test from the Azure runtime with concurrent Memory nodes, measured p95 query latency, namespace isolation, idempotent upsert/delete, bounded `topK`, and observed free-tier daily query/update use below 80% of the quota at the forecast load.
- The pinned embedding model and dimension are release inputs. A provider, model, or dimension change requires a new empty namespace and certification; V1 performs no in-place vector backfill.
- Start with no historical backfill. Only summaries and agent-authored records promoted after enablement are eligible, avoiding unreviewed conversion of Run History.
- Ship behind a tenant-disabled-by-default memory flag. Enable one internal tenant only after static, workflow, browser, and live certification pass; promote tenants gradually while provider failures, eligibility denials, and quota headroom remain within the gate.
- Existing Workflow Run outcomes remain unchanged when memory is disabled, empty, or unavailable. Rollback disables retrieval and promotion, preserves immutable evidence, and drains queued vector deletes and lifecycle work.
