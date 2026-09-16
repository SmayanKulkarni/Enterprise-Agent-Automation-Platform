# 065: Linked grant

**Source spec:** [Vendor Risk and Access linked-Case specification, source slice 13.3](../../../docs/superpowers/specs/2026-09-14-13-vendor-risk-access-spec.md#ordered-implementation-slices)

**What to build:** Create an Access Grant Case pinned to one current approved assessment version, independently evaluate subject/resource/privilege/purpose and produce an exact least-privilege approval.

**Blocked by:** 064: Assessment

**Status:** implementation-complete (fixture evidence and root verification pending)

**Produces:** Pinned Assessment-to-Access-Grant interface and exact approval evidence

- [x] Identity/Policy specialists and Access Planner produce a bounded grant proposal that an independent Case Approver authorizes against the pinned assessment and canonical arguments.
- [x] Wrong/foreign, expired, superseded or concurrently changed assessment, self/wrong-scope/stale approval and changed privilege or duration deny before any provider intent.
- [ ] Publish linked Case/dependency and Agent Team graphs, canonical approval evidence, concurrent-change fixtures, authority decisions and non-enumerating Tenant negatives.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: grants pin Tenant, assessment ID/version and canonical subject/resource/privilege/purpose/duration arguments. Approval requires a distinct approver and rechecks the assessment before any provision state is reachable.
