# 064: Assessment

**Source spec:** [Vendor Risk and Access linked-Case specification, source slice 13.2](../../../docs/superpowers/specs/2026-09-14-13-vendor-risk-access-spec.md#ordered-implementation-slices)

**What to build:** Run Vendor Assessment Cases through parallel Policy Analyst and Evidence Verifier work, conflict resolution, information intervention, independent risk decision, expiry and supersession.

**Blocked by:** 063: Package

**Status:** implementation-complete (fixture evidence and root verification pending)

**Produces:** Vendor Assessment Case tracer bullet and current assessment dependency interface

- [x] Complete attributable evidence yields approved-with-conditions, denied or insufficient-evidence outcome from an independent Policy/Risk Owner, with source version and rubric preserved.
- [x] Conflicting, missing, expired, superseded, foreign or concurrently changed evidence prevents a stale decision and opens the declared intervention or reevaluation path.
- [ ] Publish assessment Case/Agent graph, rubric/provenance, intervention and decision timeline, expiry/supersession fixtures, authority negatives and Operations evidence.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `VendorRiskAccessRuntime` preserves immutable evidence source versions, requires three distinct assessor roles, fences expected versions/currentness/expiry, and denies foreign assessment lookups. The focused fixture suite covers approval, stale/foreign denial and recovery paths.
