# 050: Policy/IaC shell

**Source spec:** [Azure infrastructure, delivery, readiness and recovery specification, source slice 11.1](../../../docs/superpowers/specs/2026-09-14-11-azure-delivery-recovery-spec.md#ordered-implementation-slices)

**What to build:** Create the Azure Bicep policy shell for the declared single-region shared-infrastructure topology, with allowlisted regions, resource types, SKUs and tags, lease metadata, cost preflight and exact plan validation.

**Blocked by:** 049a: Technical browser journey

**Status:** complete

**Produces:** Azure IaC/resource policy seam; foundation toward M9

- [x] A scoped environment plan passes syntax, policy, what-if and cost checks only when every resource is allowlisted, tagged, leased and attributable to the intended resource group/stack.
- [x] Disallowed region/SKU/type/tag, broad RBAC/network scope, missing lease or ambiguous destructive target fails before deployment and identifies the exact policy decision.
- [x] Publish plan/policy test results, what-if inventory, IaC/config digests, budget estimate, ownership tags and secret scan.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.
