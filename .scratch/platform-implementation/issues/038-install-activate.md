# 038: Install/activate

**Source spec:** [Solution Package authoring through retirement specification, source slice 8.5](../../../docs/superpowers/specs/2026-09-14-08-solution-package-lifecycle-spec.md#ordered-implementation-slices)

**What to build:** Resolve Tenant external bindings into epoch-bound installation readiness, then fence and activate one immutable revision that new Cases pin without exposing mutable lifecycle state.

**Blocked by:** 037: Trust/catalog

**Status:** completed

**Produces:** `lifecycle.tenant-installation`, `lifecycle.activation` and Case pin inputs

- [x] An authorized Tenant installs a signed compatible package, proves current provider/policy/credential readiness and atomically activates a revision used by a concurrently starting Case.
- [x] Foreign Tenant/install, stale readiness epoch, unavailable capability, concurrent activation/start, duplicate conflicting command and revoked dependency prevent an invalid pin.
- [x] Publish isolated installation/readiness records, activation receipts, concurrency fixtures, four demo activation samples and Case pin evidence.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `SolutionLifecycle.install` creates Tenant-scoped epoch readiness; `activate` fences expected installation version and idempotency key; `pin` denies foreign or revoked use.
