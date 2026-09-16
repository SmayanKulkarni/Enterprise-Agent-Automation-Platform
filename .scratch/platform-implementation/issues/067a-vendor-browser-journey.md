# 067a: Vendor Risk and Access browser journey

**Source:** [Vendor Risk and Access specification](../../../docs/superpowers/specs/2026-09-14-13-vendor-risk-access-spec.md)

**What to build:** Use the same Catalog, Case and intervention components for Vendor Assessment and linked Access Grant Cases, including independent risk decision, expiry and grant revoke/recovery.

**Blocked by:** 067: Repeat/reset, 062a: Live readiness browser
**Status:** fixture-boundary-complete (live browser evidence and root verification pending)
**Produces:** second-solution browser path

- [ ] Assessment evidence/conflict, approved version, Access Grant pin, subject/resource/privilege/purpose, exact approval, Graph/Jira receipt and `revocation-pending` are visible through authorized Case/evidence projections.
- [ ] Reuse the Case workbench's `browser.v1` codecs and registered routes with the Vendor package schemas; a linked-Case selector, event or response from another Tenant/version is rejected before display.
- [ ] Start/approve/provision/revoke/expire use existing owner command routes; a stale/superseded assessment, foreign subject or possible-send revoke never appears provisioned/revoked until reconciled.
- [ ] Repeat fixture and labeled live browser paths with two-Tenant isolation and root verification pass.

Evidence: `VendorCaseWorkbench` exposes only safe Tenant-matching assessment/grant DTOs, marks stale/superseded/reconciliation/revocation-pending state partial, and rejects foreign linked references before display. Registered `vendor.*` browser commands remain fixture-labeled until provider receipts reconcile.
