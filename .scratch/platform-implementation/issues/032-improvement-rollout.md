# 032: Rollout

**Source spec:** [Evaluation Ledger, release gates and governed improvement specification, source slice 7.4](../../../docs/superpowers/specs/2026-09-14-07-evaluation-improvement-spec.md#ordered-implementation-slices)

**What to build:** Run matched shadow and low-risk canary populations, atomically switch the champion within bounded rollout policy and execute deterministic rollback on every declared trigger.

**Blocked by:** 031: Candidate

**Status:** completed

**Produces:** Governed candidate shadow/canary/promotion/rollback interface

- [x] An evaluated candidate advances through matched shadow and eligible canary windows, then one fenced command atomically promotes it with explicit running-Case disposition.
- [x] Risk escalation, evidence drift, concurrent promote/rollback, crash at a transition and any rollback trigger stop or reverse routing without changing external-effect recovery ownership.
- [x] Publish shadow/canary population manifests, matched metrics, atomic routing receipts, crash/replay and rollback-trigger results, Operations events and labels.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `tests/platform/memory-evaluation.test.ts`; pinned root verification passed under Node 22.14.0 / pnpm 10.15.1 on 2026-09-15 and published `evidence/implementation/manifest.json`.
