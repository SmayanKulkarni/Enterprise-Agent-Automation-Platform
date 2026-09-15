# 029: Ledger

**Source spec:** [Evaluation Ledger, release gates and governed improvement specification, source slice 7.1](../../../docs/superpowers/specs/2026-09-14-07-evaluation-improvement-spec.md#ordered-implementation-slices)

**What to build:** Implement immutable Evaluation Ledger append, supersede, aggregate and compare behavior for all six canonical evidence kinds while keeping classified payloads in their owning stores.

**Blocked by:** 028a: Capability and memory views

**Status:** implementation-complete-pending-pinned-verification

**Produces:** `evaluation.ledger-record` interface

- [x] Comparable records with compatible subject, dataset/sample, rubric, evaluator, environment and aggregation semantics produce provenance-preserving aggregate and comparison results.
- [x] Missing, denied, conflicting or superseded evidence and incompatible dimensions return explicit not-comparable or normalized failure without collapsing kind or provenance.
- [x] Publish all-six-kind fixtures, ledger/aggregate manifests, comparability matrix, weak/model-label calibration inputs, canonical digests and classification scan.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `tests/platform/memory-evaluation.test.ts`; lint, static typecheck and all 23 tests passed on 2026-09-15. Pinned verification remains blocked by Node 22.14.0 being unavailable.
