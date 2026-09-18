# 009a: Clerk browser session and Tenant shell

**Source:** [authentication mapping](../../../docs/architecture/authentication-identity-mapping.md), [identity specification](../../../docs/superpowers/specs/2026-09-14-02-identity-tenant-authority-spec.md), [Wayfinder identity decision](../../frontend-mvp-integration/issues/01-clerk-identity-seam.md)

**What to build:** React entry shell with Clerk's sign-in/sign-out components and wire the 004a Express route shell through Clerk proof verification at the existing Identity ingress seam. Keep platform User, Tenant membership and Effective Authority in the backend.

**Blocked by:** 009: Ingress/lifecycle, 004a: Browser transport; Wayfinder identity decision (resolved)
**Status:** complete (local fake-adapter evidence)
**Produces:** authenticated React/Express session and logical-Tenant switch

- [x] Clerk provider/sign-in/sign-out and default `getToken()` supply a bearer **session token** to Express. Configure the static `platform-browser-api` audience as a custom session claim, exact environment issuer/key and authorized-party origins; fail closed on missing deployment values. Backend Clerk verification accepts session-token use only; each protected request also checks `sessions.getSession(sid)` is current `active` for the same `sub`, failing closed on lookup error, logout or revocation. Map immutable `(issuer,sub)` and `sid` into `identity.authenticate(proof)`, then resolve platform User and selected logical Tenant. `GET /api/v1/session` returns only safe User/Tenant/profile/action hints and epoch; no Clerk Organization claim grants membership.
- [x] Wire one ordered Express boundary: trusted proxy/origin/correlation, bearer verification, current membership/Tenant, 002a strict decode, Tenant-scoped load, exact owner authority/approval/version, named handler, safe DTO encode/redacted audit, terminal normalized error. Use bounded built-in `express.raw` to retain command bytes for 002a's single duplicate-key-aware JSON parse, fixed Router routes and one error handler; unauthenticated/invalid/foreign requests cannot reach an owner. No browser token reaches a worker, URL, persistent cache or log.
- [x] Switching Tenant refreshes all queries and closes the old event stream. Revoked User/membership/Tenant, expired session, stale epoch or logout clears cached projections and blocks commands; backend rechecks immediately before owner commit.
- [x] Signed-out/login, no-membership, suspended-Tenant and forbidden states have navigable pages; restore the intended deep link after verified sign-in without exposing tokens/codes. Keep deterministic fake-adapter evidence alongside Clerk.
- [x] Verify two-Tenant session selection, forged selector, wrong audience/origin/use, expired/revoked `sid`/proof/epoch, foreign deep link, logout, invalid/oversize JSON, response redaction and accessibility; root verification passes. Keep deterministic and live Clerk evidence separately labeled.

Evidence: `tests/platform/gateway-browser.test.ts`; root manifest slice `009a-clerk-browser-session`.
