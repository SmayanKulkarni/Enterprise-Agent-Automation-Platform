# 009: Ingress/lifecycle

**Source spec:** [Identity, logical Tenant, authentication and Effective Authority specification, source slice 2.5](../../../docs/superpowers/specs/2026-09-14-02-identity-tenant-authority-spec.md#ordered-implementation-slices)

**What to build:** Apply authentication and current authority uniformly to the complete route/worker/webhook inventory, and finish Tenant suspension, recovery, export, hold and exact-manifest deletion end to end.

**Blocked by:** 008: Authority

**Status:** complete (2026-09-15; deterministic local adapter)

**Produces:** M2 identity/isolation gate with enforced ingress and Tenant lifecycle evidence

**Execution:** Added the owner-bound `authorizeBeforeCommit` ingress seam, which performs current proof/membership/epoch authority checks before and after work, and completed suspension, recovery, legal-hold and manifest deletion transitions in the Tenant reducer. Root verification passes.

- [x] Two Tenants exercise protected synchronous and asynchronous ingress with fresh rechecks immediately before commit, and suspension/recovery/export/hold behave through the same owned commands.
- [x] Spoofed selectors, stale sessions/epochs, concurrent work during deletion, partial purge, crash/resume and foreign backup restore remain denied or incomplete until the exact manifest and residual scan reconcile.
- [x] Publish M2 route inventory with trusted-proxy/origin/correlation → authenticate → current User/Tenant/membership → 002a decode/scoped load → exact authority/approval/version → named owner → safe encode/audit ordering; include two-Tenant allow/deny run, lifecycle/audit timeline, deletion manifest/residual report, isolation results and secret scan.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.
