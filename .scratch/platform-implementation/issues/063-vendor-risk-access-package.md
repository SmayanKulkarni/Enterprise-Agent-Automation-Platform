# 063: Package

**Source spec:** [Vendor Risk and Access linked-Case specification, source slice 13.1](../../../docs/superpowers/specs/2026-09-14-13-vendor-risk-access-spec.md#ordered-implementation-slices)

**What to build:** Author, diff, resolve, validate, sign, publish, install and activate the Vendor Risk and Access Solution Package through unchanged shared interfaces, with two linked Case types and exact Graph/Jira requirements.

**Blocked by:** 062a: Live readiness browser

**Status:** implementation-complete (fixture evidence; live certification and root verification pending)

**Produces:** Signed Vendor Risk and Access package and proof of platform-module reuse

- [x] The package activates with declared assessment/grant roles, workflows, evidence/rubrics, risk/approval, memory/evaluation and provider requirements while shared-module digests match the Technical Implementation run.
- [ ] Any shared-module change, platform fork, undeclared provider operation, authority/risk widening, bad evidence label or readiness mismatch blocks publication or activation.
- [ ] Publish signed package/lock/activation pin, semantic diff, validation/install/readiness reports, shared-module digest comparison and fixture/live labels.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `vendorRiskAccessPackageFixture` uses `SolutionLifecycle` unchanged and locks the same `SHARED_PLATFORM_MODULE_DIGESTS` object as Technical Implementation. Its activation is fixture-labeled; it is not live-provider certification.
