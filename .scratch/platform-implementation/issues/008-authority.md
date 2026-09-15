# 008: Authority

**Source spec:** [Identity, logical Tenant, authentication and Effective Authority specification, source slice 2.4](../../../docs/superpowers/specs/2026-09-14-02-identity-tenant-authority-spec.md#ordered-implementation-slices)

**What to build:** Implement the deny-first Effective Authority evaluator with canonical request digests, fresh epoch-aware evidence, approval consumption and minimum-budget intersection across every authority plane.

**Blocked by:** 007: Authentication

**Status:** complete (2026-09-15; deterministic local adapter)

**Produces:** `identity.effective-authority-evidence` interface; foundation toward M2

**Execution:** Added canonical argument digesting, deny-first grant intersection, epoch/session freshness checks, exact approval consumption and a pre/post-commit authorization recheck. Root verification passes.

- [x] A protected request returns current allow evidence only when platform, Tenant, package, agent, initiator, Case/risk, provider, environment and approval scopes all intersect.
- [x] Any prohibition, stale policy/risk/package/generation/argument, malformed dependency or cache outage yields deny or indeterminate, and adding restrictions never expands authority.
- [x] Publish authority decision tables, monotonicity property seeds, cache-epoch invalidation results, approval receipts, audit samples and cross-Tenant negatives.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.
