# 053: Delivery/readiness

**Source spec:** [Azure infrastructure, delivery, readiness and recovery specification, source slice 11.4](../../../docs/superpowers/specs/2026-09-14-11-azure-delivery-recovery-spec.md#ordered-implementation-slices)

**What to build:** Implement the OIDC delivery pipeline that validates, plans, approves, fences, backs up, migrates and deploys immutable artifacts before publishing deployment/environment manifests and rerunning the unchanged M8 journey.

**Blocked by:** 052: Compute/telemetry

**Status:** fixture-verified; live Azure evidence pending

**Produces:** `deployment.deployment` and `deployment.environment-manifest` interfaces with Azure readiness

- [x] One authorized pipeline promotes exact app, package, migration, SBOM/provenance and configuration digests, verifies health/contracts/security and runs the Technical Implementation slice unchanged.
- [x] Untrusted OIDC, concurrent generation, stale manifest, secret rotation drift, partial migration/deploy and incompatible mixed-version range block readiness or enter declared recovery.
- [ ] Publish deployment/environment manifests, OIDC and generation-fence receipts, migration checkpoints, health/contract/security results, unchanged M8 run and time/cost/lease data. Live Azure evidence remains pending.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.
