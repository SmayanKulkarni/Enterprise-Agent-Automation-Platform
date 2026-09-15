# 013: Agent Team

**Source spec:** [Durable Case lifecycle, Agent Team and intervention specification, source slice 3.4](../../../docs/superpowers/specs/2026-09-14-03-case-runtime-agent-team-spec.md#ordered-implementation-slices)

**What to build:** Execute package-declared Agent Team plans through bounded assignments, immutable provenance-bearing results, explicit joins, budget fencing and a recorded model activity seam.

**Blocked by:** 012: Intervention

**Status:** complete (2026-09-15; bounded local team runtime)

**Produces:** `case.assignment` and Agent Team execution interfaces; foundation toward M3

**Execution:** Added declared-role plan validation, finite depth/budget reservations, all/quorum/first-valid joins and immutable duplicate/late result handling. Model values reuse the durable activity seam.

- [x] Sequential, all, quorum and first-valid plans schedule only declared specialists and aggregate accepted results within role, knowledge, capability, authority and budget limits.
- [x] Undeclared delegation, recursion/exhaustion, scope or budget widening, conflicting or late results and concurrent reserve/consume attempts are denied or retained as non-mutating evidence.
- [x] Publish plan validation fixtures, assignment/result graph, join matrix, budget ledger, bounded replan/delegation tests and model-activity receipts.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.
