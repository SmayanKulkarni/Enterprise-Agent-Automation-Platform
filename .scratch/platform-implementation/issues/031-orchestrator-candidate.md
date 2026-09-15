# 031: Candidate

**Source spec:** [Evaluation Ledger, release gates and governed improvement specification, source slice 7.3](../../../docs/superpowers/specs/2026-09-14-07-evaluation-improvement-spec.md#ordered-implementation-slices)

**What to build:** Create immutable Orchestrator Candidates, statically diff them against the champion, validate eligible uncontaminated datasets and record evaluated or rejected decisions.

**Blocked by:** 030: Gates

**Status:** implementation-complete-pending-pinned-verification

**Produces:** `improvement.orchestrator-candidate` creation/evaluation interface

- [x] A candidate that preserves all guardrails and meets declared dataset and gate requirements advances from candidate to evaluated with immutable diff and evidence links.
- [x] Any authority, capability, scope, risk, audit, approval or sandbox weakening, holdout contamination, weak-label excess, stale authority or conflicting command rejects deterministically.
- [x] Publish candidate/diff digests, dataset/strata/sample manifests, contamination tests, evaluation decisions, property results and audit evidence.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `tests/platform/memory-evaluation.test.ts`; lint, static typecheck and all 23 tests passed on 2026-09-15. Pinned verification remains blocked by Node 22.14.0 being unavailable.
