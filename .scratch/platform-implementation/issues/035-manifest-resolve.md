# 035: Manifest/resolve

**Source spec:** [Solution Package authoring through retirement specification, source slice 8.2](../../../docs/superpowers/specs/2026-09-14-08-solution-package-lifecycle-spec.md#ordered-implementation-slices)

**What to build:** Create canonical immutable package manifests and deterministic dependency locks, applying only declared narrowing overlays before calculating the exact package digest.

**Blocked by:** 034: Authoring

**Status:** completed

**Produces:** `lifecycle.solution-package` and `lifecycle.dependency-manifest` interfaces

- [x] Resolution selects one compatible digest per dependency, emits a reproducible lock and canonical bytes/digest, and produces the same result regardless of input ordering.
- [x] Dependency ambiguity, cycle, substitution, quarantine, digest tamper/reorder and forbidden overlay changes fail without a partially resolved package.
- [x] Publish manifest/lock schemas and digests, reproducibility results, dependency/overlay negative matrix and provenance/SBOM links.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `SolutionLifecycle.resolve` sorts immutable locks, canonicalizes all digest inputs and fails closed for duplicate dependencies, revoked digests and non-declared/widening overlays.
