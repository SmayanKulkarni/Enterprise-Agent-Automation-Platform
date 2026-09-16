# 067: Repeat/reset

**Source spec:** [Vendor Risk and Access linked-Case specification, source slice 13.5](../../../docs/superpowers/specs/2026-09-14-13-vendor-risk-access-spec.md#ordered-implementation-slices)

**What to build:** Run fixture and live Vendor Risk and Access journeys across two Tenants, remove every marked demo object and compare shared module, package, evidence and residual manifests.

**Blocked by:** 066: Provider lifecycle

**Status:** fixture-boundary-complete (paired live run and root verification pending)

**Produces:** M11 second-solution reuse and linked-Case live/fixture gate

- [ ] Repeated assessment/grant/provision/revoke runs produce equivalent logical evidence with Tenant-isolated outcomes and zero unexplained provider or local residue.
- [ ] Cross-Tenant substitution, package quarantine, partial reset, foreign/unmanaged object, held evidence and failed provider removal stop cleanup safely and report exact disposition.
- [ ] Publish M11 paired fixture/live run manifests, digest comparisons, package/module evidence, reset/removal receipts, two-Tenant negatives and residual/secret scans.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: fixture reset refuses held evidence, foreign inventory and any non-revoked grant; only fully reconciled Vendor Risk and Access fixture state reaches an empty residual inventory. Paired two-Tenant live manifests remain external evidence work.
