# 020: Installations

**Source spec:** [Provider registration, credentials and Extension isolation specification, source slice 5.2](../../../docs/superpowers/specs/2026-09-14-05-provider-extension-lifecycle-spec.md#ordered-implementation-slices)

**What to build:** Implement Tenant Provider Installation state transitions, validation, callbacks, reconciliation checkpoints and Tenant-filtered availability discovery without treating readiness as authority.

**Blocked by:** 019: Definitions/releases

**Status:** complete (local lifecycle evidence)

**Produces:** Tenant installation lifecycle, `capability.availability` and checkpoint identity

- [x] An authorized Tenant can install and validate a compatible provider, authenticate callback hints, persist ordered checkpoints and expose readiness scoped to that installation.
- [x] Wrong Tenant/account/callback/cursor, callback replay/order loss, stale generation, health/schema drift and concurrent conflicting transitions deny or quarantine without granting invocation.
- [x] Publish state-transition coverage, installation/readiness records, callback/checkpoint replay fixtures, Tenant-isolation tests and audit evidence.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `tests/platform/gateway-browser.test.ts`; root manifest slice `020-installations`.
