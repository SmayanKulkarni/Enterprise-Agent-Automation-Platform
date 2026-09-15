# 011: Durable execution

**Source spec:** [Durable Case lifecycle, Agent Team and intervention specification, source slice 3.2](../../../docs/superpowers/specs/2026-09-14-03-case-runtime-agent-team-spec.md#ordered-implementation-slices)

**What to build:** Place the Case model behind a durable history adapter with timers, generation/version fencing and recorded time, randomness, model/config choices and effect receipts so replay performs no external work.

**Blocked by:** 010: Case model

**Status:** complete (2026-09-15; deterministic local adapter)

**Produces:** `CaseWorkflowPort` durable adapter seam and replay evidence; foundation toward M3

**Execution:** Added `InMemoryCaseWorkflow`: append-only command receipts, replay reconstruction, generation/version fences, idempotent timers and recorded activities. Replay reads history only; activity work runs once at the durable boundary.

- [x] A Case survives crash at every commit boundary and replay reconstructs byte-equivalent state with exactly the recorded nondeterministic activity results.
- [x] Duplicate timers, stale leases, concurrent writers, missing activity records and replay attempts to call models, providers or secrets fail without advancing Case state.
- [x] Publish crash matrix, replay/state digests, activity call counts, lease-versus-fence tests, timer receipts and durable timeline.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.
