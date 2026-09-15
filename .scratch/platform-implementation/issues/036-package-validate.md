# 036: Validate

**Source spec:** [Solution Package authoring through retirement specification, source slice 8.3](../../../docs/superpowers/specs/2026-09-14-08-solution-package-lifecycle-spec.md#ordered-implementation-slices)

**What to build:** Validate resolved packages through static, hard and objective gates while preserving immutable fixture, simulated, Azure and live-certification evidence labels.

**Blocked by:** 035: Manifest/resolve

**Status:** completed

**Produces:** Package validation interface and gate evidence consumed by trust commands

- [x] A compatible package with complete comparable gate evidence receives an attributable validation result tied to its exact manifest and lock digests.
- [x] Schema/platform/provider incompatibility, missing/expired/incomparable evidence, hard failure and forged or substituted live labels block approval and publication.
- [x] Publish validation/gate reports for both packages, label-integrity tests, artifact/config/schema digests, fixture versions and consumer contract results.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `SolutionLifecycle.validate` pins package, lock and gate digests and denies publication unless current comparable hard/live evidence passes.
