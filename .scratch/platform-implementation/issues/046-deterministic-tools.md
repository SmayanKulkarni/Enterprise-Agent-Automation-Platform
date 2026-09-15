# 046: Deterministic tools

**Source spec:** [Local Technical Implementation vertical-slice specification, source slice 10.2](../../../docs/superpowers/specs/2026-09-14-10-local-technical-implementation-spec.md#ordered-implementation-slices)

**What to build:** Provide public-interface-only bootstrap, seed, readiness and evidence-manifest tools that deterministically create two local Tenants and version-fence every managed object.

**Blocked by:** 045: Package fixture

**Status:** complete

**Produces:** Deterministic local bootstrap/seed/readiness and run-manifest interface

- [x] Repeated bootstrap/seed with the same version is idempotent and readiness reports the exact current package, policy, provider and credential epochs for both Tenants.
- [x] Conflicting unmanaged state, stale seed version, missing dependency and cross-Tenant object reference stop before mutation and produce a safe actionable report.
- [x] Publish tool command results, seed/config/package/install digests, two-Tenant inventory, readiness manifest, correlation IDs and secret scan.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.
