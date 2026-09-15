# 039: Change lifecycle

**Source spec:** [Solution Package authoring through retirement specification, source slice 8.6](../../../docs/superpowers/specs/2026-09-14-08-solution-package-lifecycle-spec.md#ordered-implementation-slices)

**What to build:** Govern package upgrade, migration, rollback, emergency quarantine, revoke, deprecate and retire while preserving immutable running-Case pins and separating recovery dimensions.

**Blocked by:** 038: Install/activate

**Status:** complete

**Produces:** M6 signed-package installation/activation/upgrade/quarantine gate

- [x] A compatible upgrade validates side by side, checkpoints its migration and switches only new Cases; rollback selects a prior ready activation with explicit running-Case dispositions.
- [x] Failed/resumed/irreversible migration, concurrent change, compromised package, rollback-vector ambiguity, retirement under hold and attempted hot-swap deny or enter governed recovery.
- [x] Publish M6 lifecycle transition coverage, migration checkpoints/receipts, upgrade/rollback/quarantine fixtures, running-Case pins, retention/hold and audit evidence.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.
