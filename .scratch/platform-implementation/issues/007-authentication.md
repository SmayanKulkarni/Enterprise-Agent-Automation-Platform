# 007: Authentication

**Source spec:** [Identity, logical Tenant, authentication and Effective Authority specification, source slice 2.3](../../../docs/superpowers/specs/2026-09-14-02-identity-tenant-authority-spec.md#ordered-implementation-slices)

**What to build:** Provide fake and protocol-facing authentication adapters that create expiring interactive, workload, durable-worker and webhook execution contexts while keeping credentials out of domain records. Reserve the Clerk session-token adapter seam for 009a; Clerk browser proof must use the same `identity.authenticate(proof)` path.

**Blocked by:** 006: Memberships/approvals

**Status:** complete (2026-09-15; deterministic local adapter)

**Produces:** `identity.authenticated-execution-context` interface and authentication adapter seam; foundation toward M2

**Execution:** Added a shared proof-to-expiring-context seam for interactive, workload, worker and webhook modes, with audience, expiry, session and webhook replay checks; selected Tenant is verified only after immutable principal mapping. Root verification passes.

- [x] Each ingress mode validates its proof and resolves an authenticated principal plus selected logical Tenant into a bounded, expiring execution context.
- [x] Wrong issuer/audience/key/time, nonce/state/PKCE, CSRF/origin/forwarded host, forged or replayed webhook and persisted user-token reuse fail before typed commands.
- [x] Interactive adapter input preserves exact issuer, subject, session ID, audience/authorized party, expiry and token-use evidence; neither external Organization claims nor route Tenant selectors become membership/authority.
- [x] Publish authentication mapping fixtures, ingress-mode decision results, expiry/replay tests, safe diagnostics and secret scan.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.
