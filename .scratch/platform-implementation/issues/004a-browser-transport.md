# 004a: Browser transport contract

**Source:** [contract foundation](../../../docs/superpowers/specs/2026-09-14-platform-specification-index.md), [ingress](../../../docs/contracts/ingress-enforcement.md), [Wayfinder transport decision](../../frontend-mvp-integration/issues/03-browser-command-and-event-transport.md)

**What to build:** Version the `browser.v1` HTTP/SSE contract and implement a fixed Express route shell using 002a's packed codecs. Registered routes whose owners are not yet implemented return safe `501 FEATURE_NOT_READY`; later owner slices wire their executable output into those routes. The shell does not bypass 009's Identity ingress when that owner lands.

**Blocked by:** 004: Governance; Wayfinder transport decision (resolved)
**Status:** complete (2026-09-15; deterministic local route shell)
**Produces:** `browser.v1` route, command, receipt, error and event contract

**Endpoint connections (`browser.v1`; register named owner commands only as their executable interfaces land):**

| Browser route | Backend owner output | Update path |
| --- | --- | --- |
| `GET /api/v1/session`, `/api/v1/tenants` | Identity execution context, current memberships | Revalidate on each command/session change |
| `GET /api/v1/tenants/:tenantId/cases[/:caseId]`, `/interventions[/:requestId]` | Runtime Case/intervention projection | Case owner events, then query refresh |
| `GET /api/v1/tenants/:tenantId/capabilities[/:id]`, `/installations[/:id]` | Gateway availability/installations/credential references | Gateway events, then query refresh |
| `GET /api/v1/tenants/:tenantId/memory[/:id]` | Memory query/provenance/experience projection | Memory events, then query refresh |
| `GET /api/v1/tenants/:tenantId/evaluations[/:id]`, `/improvements[/:id]` | Evaluation ledger/gates; Improvement candidates/rollout | Owning events, then query refresh |
| `GET /api/v1/tenants/:tenantId/packages[/:id]` | Studio draft or Lifecycle trusted catalog/package projection | Lifecycle/Studio events, then query refresh |
| `GET /api/v1/tenants/:tenantId/operations[/:id]`, `/deployments[/:id]` | Operations authorized read model; Azure deployment manifests | Operations/Azure events, then query refresh |
| `POST /api/v1/tenants/:tenantId/commands/:owner/:name` | Named Identity, Runtime, Gateway, Memory, Improvement, Lifecycle or Azure owner command via Operations transport | Owner receipt first; projection watermark later |
| `GET /api/v1/tenants/:tenantId/events` | Operations authorized safe event projection | SSE resume/refresh; polling fallback |

**Transfer policy:** Clerk **session** proof travels as `Authorization: Bearer` on `fetch`, including fetch-streamed SSE; tokens never enter URLs or persistent client stores. Same-origin/allowlisted Origin checks apply to mutations and streams; no CORS or cookie command mode in this slice. Route Tenant is only a selector for current verified User membership. Events are at-least-once refresh hints: dedupe by `(owner,eventId)`, compare owner sequence and contract version, resume by bounded global cursor in `Last-Event-ID`, and refetch on gap/expiry/mismatch. Classified content travels only as safe references/redaction markers. A command retry reuses its idempotency key and digest; a possible-send timeout is `unknown-outcome` until owner receipt/reconciliation.

**Execution:** Added the dependency-free fixed `browser.v1` route handler, route inventory, strict packed codec boundary, named command registry, tenant-bound cursor/page validation and safe `FEATURE_NOT_READY` fallback. Express remains an adapter concern for 009a; no web framework was added before that owner exists.

- [x] Mount one fixed `/api/v1` Router with explicit methods/resource routes and a named owner-command registry; validate UUID selectors, bounded page size and opaque Tenant-bound cursors. Register `GET /session`, `/tenants`, Tenant collection/detail GETs, named POST commands and `GET .../events`; no wildcard command dispatch or fabricated owner response. Route inventory records owner, exact authority action, scoped loader, classification, request/response schema and feature-ready state.
- [x] Define `browser.v1` request/response/error/SSE schemas using 002a codecs. Retain exact command bytes with bounded built-in `express.raw`, then do one strict codec parse; enforce contract media type/version, duplicate-key rejection, URL/header/body validation, declared normalization before canonical digest, and route-specific safe DTO encoding/redaction. Each response has correlation, contract/version, owner version and watermark/completeness where applicable; no raw domain object/provider error/stack reaches JSON or SSE.
- [x] Command body binds resource, expected generation/version, canonical arguments/digest, reason, deadline and approval reference; headers bind bearer proof, `Idempotency-Key`, `X-Correlation-Id`, and agreeing `If-Match`. The route invokes only the named owner command, returns its durable commit receipt plus independent projection status, and handles identical/conflicting retries and unknown-outcome without inventing success.
- [x] Register `GET .../events` as a safe Operations projection stream contract with fetch-header `Last-Event-ID`, bounded replay cursor, heartbeat and reconnect; frame includes owner/event ID/sequence, Tenant, resource, correlation/causation, contract/version, watermark and safe classification/reference. Until 040/041 own the feed, return `FEATURE_NOT_READY` and use authorized GET polling. Reconnect and each publish recheck active session/membership/epoch; a gap/version mismatch forces query refresh.
- [x] One terminal normalized error handler handles malformed/version-incompatible commands, cross-Tenant selectors/streams, secret events, stale versions and dependency failures without existence leakage. One two-Tenant HTTP/codec/SSE-or-poll runnable check and root verification pass.
