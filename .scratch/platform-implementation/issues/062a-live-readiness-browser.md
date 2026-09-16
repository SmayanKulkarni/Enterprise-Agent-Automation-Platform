# 062a: Live provider and deployment readiness browser

**Source:** [live provider specification](../../../docs/superpowers/specs/2026-09-14-12-live-provider-adapters-spec.md), [Azure delivery specification](../../../docs/superpowers/specs/2026-09-14-11-azure-delivery-recovery-spec.md)

**What to build:** Extend existing capability and Operations views to Graph, SQL, Blob, Boards and Jira certification/readiness and Azure deployment/restore/teardown evidence.

**Blocked by:** 062: Combined readiness, 049a: Technical browser journey
**Status:** fixture-boundary-complete (live browser evidence and root verification pending)
**Produces:** live/fixture-disambiguated readiness browser path

- [ ] Show provider/API/auth/schema version, installation/credential epoch, callback/checkpoint, reconcile/throttle state, environment/deployment manifest, lease, health and exact evidence label; never infer live readiness from fixture evidence.
- [ ] Read validated, classified-safe readiness DTOs only; version/cursor mismatch or projection gap refetches scoped owner GETs and cannot convert fixture/Mongo readiness into Azure/live certification.
- [ ] Reauthorize/rotate/reconcile and deploy/restore/teardown use existing owner commands and exact approval/manifest; stale credential, partial removal, unknown outcome and restore quarantine block a success display.
- [ ] Browser two-Tenant/foreign-installation and one labeled live readiness/teardown evidence check plus root verification pass.

Evidence: `ReadinessWorkbench` accepts classified-safe readiness/deployment DTOs, treats fixture, stale, unknown-outcome and restore-quarantined records as partial, and rejects an unverified `live` label. `VendorCaseWorkbench` rejects foreign linked-case records before display; both use the existing browser command boundary. Browser live evidence still requires allocated providers and an Azure environment.
