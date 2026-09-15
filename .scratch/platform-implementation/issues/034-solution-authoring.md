# 034: Authoring

**Source spec:** [Solution Package authoring through retirement specification, source slice 8.1](../../../docs/superpowers/specs/2026-09-14-08-solution-package-lifecycle-spec.md#ordered-implementation-slices)

**What to build:** Provide typed Solution Studio authoring, semantic/security diffing and local simulation for Agent Definitions, Skill Modules and both reference package shapes through one package interface.

**Blocked by:** 033a: Evaluation and improvement views

**Status:** completed

**Produces:** Typed author/diff/simulation interface for Solution Packages

- [x] Authors can create and diff typed artifacts, apply imports/defaults before bounded overrides and simulate behavior with explicit package, policy and fixture versions.
- [x] Unknown fields, secrets, Tenant/runtime state, executable content and changes that widen authority, scope, risk, budgets or hard guardrails fail authoring or semantic diff.
- [x] Publish typed authoring fixtures for both packages, semantic/security diffs, simulation manifests, artifact digests and secret/executable scans.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `SolutionLifecycle.author` has immutable, typed artifact validation and recursive secret/executable rejection; the focused platform fixture exercises authoring.
