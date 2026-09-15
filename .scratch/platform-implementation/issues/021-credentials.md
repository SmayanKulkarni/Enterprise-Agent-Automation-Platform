# 021: Credentials

**Source spec:** [Provider registration, credentials and Extension isolation specification, source slice 5.3](../../../docs/superpowers/specs/2026-09-14-05-provider-extension-lifecycle-spec.md#ordered-implementation-slices)

**What to build:** Broker credential consent, invocation-local acquisition, probe-then-switch rotation, revocation and epoch-aware caching through reference-only records and a fake secret-store adapter.

**Blocked by:** 020: Installations

**Status:** complete

**Produces:** `capability.credential-reference` and `CredentialBroker` interface

- [x] A scoped credential reference is acquired only for one authorized invocation, rotates after a successful probe with one refresh lease, and invalidates caches immediately on epoch change.
- [x] Scope broadening without consent, failed/concurrent rotation, stale or revoked cache, expired credential and secret-store outage deny new work while in-flight effects receive explicit disposition.
- [x] Publish credential epoch/rotation/revocation receipts, lease/concurrency tests, reference-only record samples, cache invalidation results and recursive secret scan.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `tests/platform/lifecycle-memory.test.ts`; pinned `pnpm verify` passed on 2026-09-15 and published `evidence/implementation/manifest.json`.
