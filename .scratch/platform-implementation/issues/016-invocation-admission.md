# 016: Invocation/admission

**Source spec:** [Effect intent, idempotency and Capability Gateway core specification, source slice 4.2](../../../docs/superpowers/specs/2026-09-14-04-effects-gateway-core-spec.md#ordered-implementation-slices)

**What to build:** Implement Gateway invocation and admission through the minimal ProviderAdapter seam, validating schema, Tenant references, fresh authority, approval, generation, installation, credential, budget, idempotency and throttle state.

**Blocked by:** 015: Intent/idempotency

**Status:** complete (local fake-adapter evidence)

**Produces:** `capability.invocation`, normalized error and minimal `ProviderAdapter` seam

- [x] An admitted fake capability receives only the normalized operation, constrained account/resource, exact arguments, effect marker, deadline and invocation-local credential and returns a canonical result.
- [x] Malformed schema/version, foreign Tenant/account, stale evidence, unavailable installation, exhausted budget and an adapter attempting to widen target or authority fail before dispatch.
- [x] Publish admission decision matrix, fake-adapter conformance results, invocation/result samples, safe error mappings, cross-Tenant negatives and secret scan.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `tests/platform/gateway-browser.test.ts`; root manifest slice `016-invocation-admission`.
