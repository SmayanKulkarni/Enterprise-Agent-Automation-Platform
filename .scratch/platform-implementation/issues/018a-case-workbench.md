# 018a: Case workbench and interventions

**Source:** [Case lifecycle](../../../docs/contracts/case-lifecycle.md), [human intervention](../../../docs/contracts/human-intervention.md), [effect/gateway core](../../../docs/superpowers/specs/2026-09-14-04-effects-gateway-core-spec.md)

**What to build:** Thin Case list/detail with state, stage, Agent Team assignments, effect intent/attempt/receipt/reconciliation, outcome, package pin, linked Cases, and all five intervention types.

**Blocked by:** 018: Flow control, 009a: Clerk browser session
**Status:** complete (local browser-boundary evidence)
**Produces:** browser Case and intervention path

- [x] Consume `GET .../cases`, `GET .../cases/:caseId`, `GET .../interventions` and Case-scoped evidence projections; show generation/version, watermark, classification/redaction, waiting work, approval digest, unknown-outcome and reconciliation separately.
- [x] Decode only `browser.v1` safe Case/intervention DTOs; a mismatched response version, stale watermark or event-sequence gap triggers a scoped GET refresh. Scenario-specific input fields come from the pinned package schema, not a hard-coded second Case workflow.
- [x] Submit create/submit/start/cancel/reopen and information, approval/rejection, correction, operator-recovery or break-glass responses only through `POST .../commands/case/:name` or `.../commands/identity/:name`, with expected version, exact request digest, idempotency key and server authority preview. Do not expose agent/Gateway internals as direct browser effects.
- [x] Disable stale or ineligible actions; on conflict refresh and preserve typed draft, on identical retry show the recorded receipt, on possible-send timeout show unknown outcome pending reconciliation. One crash/replay plus late/duplicate/foreign response browser check and root verification pass.

Evidence: `tests/platform/gateway-browser.test.ts`; root manifest slice `018a-case-workbench`.
