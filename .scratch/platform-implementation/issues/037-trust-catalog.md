# 037: Trust/catalog

**Source spec:** [Solution Package authoring through retirement specification, source slice 8.4](../../../docs/superpowers/specs/2026-09-14-08-solution-package-lifecycle-spec.md#ordered-implementation-slices)

**What to build:** Enforce independent approve, sign and publish commands, key trust/rotation/revocation and Tenant-filtered Governed Catalog discovery over immutable validated package bytes.

**Blocked by:** 036: Validate

**Status:** completed

**Produces:** Trusted publication and Tenant-filtered Governed Catalog interface

- [x] Distinct authorized actors approve, sign and publish an exact package/lock/provenance/SBOM/gate digest, and only eligible Tenants discover the verified artifact.
- [x] Self-approval for R2/R3, bad/revoked/compromised signature, replayed publication, foreign Tenant discovery and post-signature tamper deny new use while preserving historical verification.
- [x] Publish command/actor separation tests, signature/rotation/revocation records, Catalog filtering results, publication receipt and signed digest inventory.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `SolutionLifecycle.publish` separates author/approver/signer/publisher, records all signed digests, makes publication idempotent and filters Catalog discovery by Tenant.
