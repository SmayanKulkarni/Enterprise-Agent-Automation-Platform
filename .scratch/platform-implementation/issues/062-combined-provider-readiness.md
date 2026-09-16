# 062: Combined readiness

**Source spec:** [Live Graph, SQL, Blob, Boards and Jira adapter specification, source slice 12.7](../../../docs/superpowers/specs/2026-09-14-12-live-provider-adapters-spec.md#ordered-implementation-slices)

**What to build:** Prove all five adapters together through credential rotation, disable/revoke/remove, missed push recovery, cross-Tenant denial, both-solution allocation and exact residual cleanup.

**Blocked by:** 061: Jira

**Status:** fixture-boundary-complete (live certification and root verification pending)

**Produces:** M10 certified live-provider readiness/reconcile/reset gate

- [ ] Technical Implementation receives ready Graph/SQL/Blob/Boards allocation and Vendor Risk and Access receives ready Graph/Jira allocation with current per-installation epochs and live evidence.
- [ ] Any stale credential/schema/checkpoint, cross-Tenant substitution, missed push, partial removal, callback/token/grant residue or unmanaged object blocks combined readiness and clean reset.
- [ ] Publish M10 combined live manifest, per-provider certification links, rotation/revocation/removal timeline, both-solution allocation, reconciliation and residual/secret scans.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `combinedProviderReadiness` admits only the six declared Technical Implementation/Vendor Risk and Access installations for one Tenant, rejects stale/non-ready, foreign, duplicate or mixed-label records, and permits a `live` label only with an injected verifier. The focused fixture test passes; allocated live providers and the pinned Node 22.14.0/pnpm 10.15.1 toolchain remain required for the unchecked certification rows.
