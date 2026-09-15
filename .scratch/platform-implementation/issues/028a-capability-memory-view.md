# 028a: Capability and memory views

**Source:** [provider lifecycle](../../../docs/superpowers/specs/2026-09-14-05-provider-extension-lifecycle-spec.md), [memory specification](../../../docs/superpowers/specs/2026-09-14-06-memory-validated-experience-spec.md)

**What to build:** Tenant-scoped capability installation/credential-reference readiness and governed memory/Validated Experience screens using owner projections.

**Blocked by:** 028: Experience, 018a: Case workbench
**Status:** implementation-complete-pending-pinned-verification
**Produces:** browser provider and memory coverage

- [x] `GET .../capabilities`, `GET .../installations`, `GET .../memory` expose versions, readiness, checkpoint/epoch, provenance, classification, hold/quarantine/partial state and safe references; credential bytes and retrieved secret payloads never enter React, SSE or logs.
- [x] Consume packed safe DTOs and the 004a event-or-poll refresh path; unknown/incompatible response versions, stream gaps and redacted records remain partial rather than becoming actionable client state.
- [x] Install/disable/reauthorize/rotate/revoke and memory correction/export/hold/deletion/restore/experience promotion submit only named Gateway or Memory owner commands with authority/approval, expected version and exact manifest where destructive. Availability is never shown as authority to invoke.
- [ ] Two-Tenant reference substitution, expired credential epoch, stale memory cache, hold-blocked deletion and partial restore render safe states and leave no mutation; root verification passes.

Evidence: `tests/platform/memory-evaluation.test.ts`; runtime browser projection routes were already supplied by 018a. Pinned root verification remains blocked by Node 22.14.0 being unavailable.
