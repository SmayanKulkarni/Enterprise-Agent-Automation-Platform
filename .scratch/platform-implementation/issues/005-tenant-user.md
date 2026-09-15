# 005: Tenant/User

**Source spec:** [Identity, logical Tenant, authentication and Effective Authority specification, source slice 2.1](../../../docs/superpowers/specs/2026-09-14-02-identity-tenant-authority-spec.md#ordered-implementation-slices)

**What to build:** Implement logical Tenant and User lifecycle reducers behind Tenant-first repository interfaces, with deterministic state transitions and storage guards that make unscoped access impossible.

**Blocked by:** 004a: Browser transport

**Status:** complete (2026-09-15; deterministic local adapter)

**Produces:** `identity.tenant` and `identity.user` lifecycle/repository interfaces; foundation toward M2

**Execution:** Added the fail-closed Tenant/User in-memory repository with immutable issuer/subject mapping, explicit Tenant scope, lifecycle version/epoch fences, legal hold and manifest export. Focused two-scope/epoch tests and root verification pass.

- [x] Two Tenants can provision, suspend, recover and advance lifecycle independently while immutable issuer/subject mappings resolve the correct scoped User.
- [x] Cross-Tenant ID substitution, invalid transitions, mapping collisions, stale expected versions and unscoped repository access deny without revealing foreign existence.
- [x] Publish transition coverage, repository contract results, SQL isolation plan/results, property seeds, audit samples and secret scan.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.
