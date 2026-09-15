# 033: Selector

**Source spec:** [Evaluation Ledger, release gates and governed improvement specification, source slice 7.5](../../../docs/superpowers/specs/2026-09-14-07-evaluation-improvement-spec.md#ordered-implementation-slices)

**What to build:** Expose a bounded Strategy Selector that becomes eligible only at its higher evidence threshold and chooses among approved strategies without planning or expanding authority.

**Blocked by:** 032: Rollout

**Status:** completed

**Produces:** M5b governed-improvement gate and constrained `StrategySelector` interface

- [x] For eligible features and current evidence, the selector returns one approved strategy with attributable version and deterministic routing evidence.
- [x] Uncertainty, drift, outage, revocation, out-of-set strategy and attempted authority expansion use the deterministic fallback or deny without changing Case policy.
- [x] Publish M5b eligibility/selection fixtures, drift/outage matrix, deterministic fallback digests, routing receipts and authority-negative tests.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `StrategySelector` in `packages/memory/src/evaluation.ts`; focused platform fixture covers eligible selection and deterministic fallback.
