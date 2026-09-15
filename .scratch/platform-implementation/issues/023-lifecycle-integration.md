# 023: Lifecycle integration

**Source spec:** [Provider registration, credentials and Extension isolation specification, source slice 5.5](../../../docs/superpowers/specs/2026-09-14-05-provider-extension-lifecycle-spec.md#ordered-implementation-slices)

**What to build:** Integrate installation health, schema drift, credential epochs, side-by-side adapter upgrade, quarantine/removal and residual reconciliation into the readiness evidence consumed by Solution Lifecycle.

**Blocked by:** 022: Extension isolation

**Status:** complete

**Produces:** Provider installation readiness/removal interface consumed by Lifecycle

- [x] A candidate adapter validates side by side, switches availability atomically, preserves the version pinned to in-flight records and publishes an epoch-bound readiness result.
- [x] Failed upgrade, revoke/quarantine/remove during in-flight work, removal crash/resume, unknown provider state and retained callbacks/credentials/residue deny readiness until reconciled.
- [x] Publish M4-extension transition and readiness evidence, upgrade/removal receipts, retained-disposition inventory, reconciliation timeline, resource/secret/residue scans.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `tests/platform/lifecycle-memory.test.ts`; pinned `pnpm verify` passed on 2026-09-15 and published `evidence/implementation/manifest.json`.
