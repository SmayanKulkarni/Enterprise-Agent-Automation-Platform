# 006: Memberships/approvals

**Source spec:** [Identity, logical Tenant, authentication and Effective Authority specification, source slice 2.2](../../../docs/superpowers/specs/2026-09-14-02-identity-tenant-authority-spec.md#ordered-implementation-slices)

**What to build:** Add invitation, membership, Capability Profile, risk-tier and approval lifecycles that produce immutable scope-bound evidence for later authority decisions.

**Blocked by:** 005: Tenant/User

**Status:** complete (2026-09-15; deterministic local adapter)

**Produces:** `identity.membership`, `identity.risk` and `identity.approval-evidence` interfaces; foundation toward M2

**Execution:** Added versioned membership activation/suspension/revocation plus immutable scope-bound R2/R3 approval creation and single-use consumption. The focused test covers independent approver, scope binding, consumption and deny paths; root verification passes.

- [x] A current member with the required Capability Profile can request, independently decide and atomically consume an R2/R3 approval bound to exact Tenant, Case, generation, action, target and argument digest.
- [x] Absent, suspended or revoked membership and self, wrong-scope, expired, reused or concurrently consumed approval deny with one non-enumerating outcome.
- [x] Publish membership/approval transition tables, concurrent-consumption results, immutable evidence samples, property seeds and Tenant-substitution negatives.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.
