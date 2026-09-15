# 033a: Evaluation and improvement views

**Source:** [evaluation/improvement specification](../../../docs/superpowers/specs/2026-09-14-07-evaluation-improvement-spec.md)

**What to build:** Readable Evaluation Ledger, gate evidence, Orchestrator Candidate comparison and shadow/canary/rollback status with minimal authorized commands.

**Blocked by:** 033: Selector, 028a: Capability and memory views
**Status:** completed
**Produces:** browser evaluation and improvement coverage

- [x] `GET .../evaluations` and `GET .../improvements` show immutable record IDs, evidence kind/source/version, gate decision, candidate/champion, rollout population, freshness and restricted/partial data.
- [x] Consume only validated `browser.v1` DTOs and scoped event-or-poll refresh; version mismatch or stale/partial gate evidence disables promotion until a fresh authorized GET.
- [x] Submit candidate creation, evaluate, shadow, canary, promote or rollback only through Improvement owner command routes with current gate evidence, expected version and R3 approval; show exact consequence before submission.
- [x] Foreign evidence, failed gate, stale candidate, duplicate promotion and rollback triggers cannot become client-success states until owner receipt; root verification passes.

Evidence: `ImprovementWorkbench` accepts only safe `browser.v1` DTO state and rejects stale gate promotion.
