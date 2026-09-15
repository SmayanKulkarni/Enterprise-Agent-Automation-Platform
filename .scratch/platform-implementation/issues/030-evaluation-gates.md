# 030: Gates

**Source spec:** [Evaluation Ledger, release gates and governed improvement specification, source slice 7.2](../../../docs/superpowers/specs/2026-09-14-07-evaluation-improvement-spec.md#ordered-implementation-slices)

**What to build:** Calculate hard and objective release gates from immutable manifests, apply only independently governed scoped exceptions and revalidate when evidence dependencies drift.

**Blocked by:** 029: Ledger

**Status:** implementation-complete-pending-pinned-verification

**Produces:** Release-gate calculation interface consumed by Lifecycle

- [x] A complete comparable evidence manifest deterministically reports every hard/objective result, confidence and threshold, with valid exceptions scoped and expiring.
- [x] Hard failures, insufficient samples, missing/incomparable evidence, expired exceptions and evaluator/rubric/model/dataset/provider drift block release; security and integrity gates cannot be waived.
- [x] Publish gate manifests, threshold/confidence calculations, exception audit records, revalidation-trigger matrix and deterministic fixture results.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `tests/platform/memory-evaluation.test.ts`; lint, static typecheck and all 23 tests passed on 2026-09-15. Pinned verification remains blocked by Node 22.14.0 being unavailable.
