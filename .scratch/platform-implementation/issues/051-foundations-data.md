# 051: Foundations/data

**Source spec:** [Azure infrastructure, delivery, readiness and recovery specification, source slice 11.2](../../../docs/superpowers/specs/2026-09-14-11-azure-delivery-recovery-spec.md#ordered-implementation-slices)

**What to build:** Provision scoped network, user-assigned identities/RBAC, Key Vault references, Storage/Durable Functions state, Azure SQL, backup and Tenant-isolated quarantine restore behind the already proven interfaces.

**Blocked by:** 050: Policy/IaC shell

**Status:** fixture-verified; live Azure evidence pending

**Produces:** Azure identity, repository, workflow, secret and backup adapter foundations

- [x] Repositories, workflow history and secret-reference adapters pass their contract fixtures with private ingress, least privilege, backup coverage and Tenant-scoped restore inventory.
- [x] Overbroad identity/RBAC/network, secret values in configuration, backup omission, foreign Tenant data and restore outside quarantine deny readiness without mutating active state.
- [ ] Publish identity/RBAC/network policy results, contract suites, backup manifest, Tenant restore-isolation tests, resource/config digests and secret scan. Live Azure evidence remains pending.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.
