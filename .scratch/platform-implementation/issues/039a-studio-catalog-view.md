# 039a: Solution Studio and Governed Catalog views

**Source:** [product information architecture](../../../docs/architecture/product-information-architecture.md), [package lifecycle](../../../docs/superpowers/specs/2026-09-14-08-solution-package-lifecycle-spec.md)

**What to build:** Minimal three-surface navigation; Studio author/diff/validate/simulate/evaluate and Catalog review/sign/publish/discover/install/activate/upgrade/quarantine/retire paths using Clerk's prebuilt auth components, native form controls and owner contracts. The current workspace has no general React component library to reuse.

**Blocked by:** 039: Change lifecycle, 033a: Evaluation and improvement views
**Status:** complete
**Produces:** browser Studio/Catalog path

- [x] `GET .../packages` and `GET .../installations` show immutable manifest/lock/revision, dependencies, trust/signature, readiness, Tenant filters, activation and running-Case pins; author forms use typed schemas and preserve draft on validation failure.
- [x] Mount Studio and Catalog deep links under the authenticated Tenant shell and consume only validated `browser.v1` safe DTOs; switching Tenant or receiving an incompatible version clears old package/install views. Registered owner routes that are not ready show `FEATURE_NOT_READY`.
- [x] Studio commands never install or operate live Cases; independent approval/sign/publish and Tenant install/activate/upgrade/quarantine/retire use Lifecycle owner commands, exact version/approval/idempotency and consequence preview. Show blocked dependencies and incompatible revision clearly.
- [x] Verify untrusted/tampered package, foreign installation, stale readiness and quarantine with a pinned running Case; root verification passes.
