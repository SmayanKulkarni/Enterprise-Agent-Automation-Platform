# 012: Intervention

**Source spec:** [Durable Case lifecycle, Agent Team and intervention specification, source slice 3.3](../../../docs/superpowers/specs/2026-09-14-03-case-runtime-agent-team-spec.md#ordered-implementation-slices)

**What to build:** Support all five human intervention types as durable Case waits with typed responses, quorum and first-valid joins, corrections, expiry and current authority checks.

**Blocked by:** 011: Durable execution

**Status:** complete (2026-09-15; durable local joins)

**Produces:** `case.intervention` interface with durable wait/join evidence; foundation toward M3

**Execution:** Added typed durable intervention requests for all five types, fixed first-valid/quorum/all join policy, exact responder/fence/deadline checks and immutable idempotency receipts.

- [x] Authorized responders complete information, decision, approval, correction and operator interventions, and join policy advances the Case exactly once with attributable evidence.
- [x] Wrong responder/scope, stale generation, duplicate/conflicting/late response, expiry, correction race and quarantined evidence cannot unblock or mutate a closed join.
- [x] Publish intervention transition coverage, wait/replay traces, quorum/first-valid fixtures, authority negatives and immutable intervention timeline.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.
