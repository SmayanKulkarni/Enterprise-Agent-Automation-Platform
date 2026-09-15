# 014: Recovery

**Source spec:** [Durable Case lifecycle, Agent Team and intervention specification, source slice 3.5](../../../docs/superpowers/specs/2026-09-14-03-case-runtime-agent-team-spec.md#ordered-implementation-slices)

**What to build:** Complete durable pause, resume, cancel, supersede and compensation behavior with explicit disposition of every assignment, timer, approval, effect, evidence and dependency.

**Blocked by:** 013: Agent Team

**Status:** complete (2026-09-15; recovery fence and disposition ledger)

**Produces:** M3 deterministic Case crash/replay/recovery gate and effect-intent-ready timeline

**Execution:** Added pause/resume scheduling fences and an explicit no-implicit-transfer disposition ledger. Unknown/reconcile work remains a distinct disposition rather than a success state.

- [x] Pause stops new scheduling at safe points; resume revalidates current dependencies; cancel or supersede produces a complete disposition and separately evidenced compensation where required.
- [x] Unknown effects, compensation failure, concurrent operator commands, crash/replay, stale dependencies and held evidence prevent false success and remain visible as reconcile or operator work.
- [x] Publish M3 end-to-end Case timeline, disposition manifest, compensation/residual report, replay digests, budget/intervention evidence and Tenant/authority negatives.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.
