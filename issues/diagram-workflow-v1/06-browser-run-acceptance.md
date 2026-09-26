# 06: Browser run experience and acceptance

**Status:** ready-for-agent
**Source spec:** [V1 integration](00-spec.md)
**Blocked by:** 01–05

## What to build

Finish Solution Studio's live save, validation, review, publish, start, run-status, Approval, receipt, and reconciliation flows over the existing authenticated browser API. Show tenant-scoped Run History and safe projections. Keep fixture and live states distinct; do not present hardcoded governance metrics or local checks as live outcomes. Preserve the existing landing and unrelated platform surfaces.

## Acceptance

- [ ] The browser uses server receipts and refreshed projections for draft, publication, run, Approval, and reconciliation state.
- [ ] Invalid graph nodes/edges are identifiable in the editor and publication remains unavailable until server validation passes.
- [ ] Editors can save/check; only admins can publish, approve exact effects, and reconcile unknown outcomes, with server enforcement.
- [ ] Run status shows the pinned revision, ordered node outcomes, waiting reason, prior effects, and failure/reconciliation state without leaking secret payloads.
- [ ] Tenant switch/sign-out clears cached drafts, run data, and streams; stale or partial projections are labeled accurately.
- [ ] One end-to-end test through authenticated browser requests covers save, admin publication, start, execution, receipt, and read projection; negative cases cover stale revision, tenant isolation, fixture evidence, and uncertain effects.
- [ ] Existing browser, Studio, Case, and package journeys remain green under the repository's normal verification commands.
