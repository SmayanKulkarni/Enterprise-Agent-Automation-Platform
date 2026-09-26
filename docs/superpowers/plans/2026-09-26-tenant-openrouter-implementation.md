# Tenant OpenRouter Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each tenant configure its own OpenRouter key and run only approved, pinned OpenRouter Agent models through a server-resolved credential.

**Architecture:** Keep tenant connection metadata and authenticated ciphertext in the existing workflow record store. Add a dedicated authenticated key submission path, then resolve that record in the model adapter at execution time. Reuse the current graph publication and Studio command/projection seams for nonsecret model settings and readiness.

**Tech Stack:** TypeScript, React, Azure Functions, Azure SQL, Node crypto, Clerk, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-26-tenant-openrouter-studio-design.md`

## Global Constraints

- Azure OpenAI remains the default; OpenRouter is tenant BYOK with tenant administrator connection controls.
- Never return or persist the OpenRouter key in browser storage, generic commands, projections, drafts, definitions, logs, or Run History.
- Keep `CONTEXT.md` a glossary; record final workflow decisions in `docs/diagram-workflow-v1-decisions.md`.
- Do not add code comments or a new dependency. Do not edit the user's pending `database/migrations/007_webhook_admission_and_history.sql` or `database/seed/002_connected_demo.sql` changes.
- Published model and fallback IDs are exact, allow-listed, and provider-compatible; runtime checks current tenant connection state.

---

## File map

| File | Responsibility |
| --- | --- |
| `database/migrations/008_openrouter_connection.sql` | Extend the workflow record-kind constraint; confirm final migration number against the current branch before creating it. |
| `packages/workflow/src/openrouter-connection.ts` | Validate, encrypt, decrypt, and redact one tenant connection; no browser imports. |
| `packages/workflow/src/service.ts` | Admin lifecycle, safe projection, provider readiness and publication checks. |
| `packages/workflow/src/sql.ts` | Reuse tenant-scoped record reads/writes; extend `RecordKind` only. |
| `packages/browser/src/index.ts`, `local-browser-host.ts`, `browser-contracts.ts` | Dedicated secret route, authentication/authorization wiring, and safe projection registration. |
| `packages/browser/src/browser-response.ts`, `azure-functions/src/functions/browser-api.ts` | Preserve body-size, CORS, and redacted response behavior on the new route. |
| `packages/workflow/src/ports.ts`, `azure-functions/src/functions/workflow-run.ts` | Resolve tenant key server-side and dispatch OpenRouter calls. |
| `apps/browser/src/platform-api.ts`, `platform-app.tsx`, `workflow-model.ts` | Admin connection UI and typed Agent controls; no key in generic command state. |
| Existing `*.test.ts` beside touched modules | Focused boundary and neighboring-behavior tests. |

### Task 1: Configure a verified tenant key and read only redacted status

**Files:** Create `database/migrations/008_openrouter_connection.sql`, `packages/workflow/src/openrouter-connection.ts`, `packages/workflow/src/openrouter-connection.test.ts`; modify `packages/workflow/src/sql.ts`, `packages/workflow/src/service.ts`, `packages/browser/src/index.ts`, `packages/browser/src/local-browser-host.ts`, `packages/browser/src/browser-contracts.ts`, `packages/browser/src/browser-response.ts`, `apps/browser/src/platform-api.ts`; test `packages/browser/src/local-browser-host.test.ts`.

**Interfaces:** Produce `sealOpenRouterKey(tenantId: string, key: string, keyVersion: string, wrappingKey: Buffer): EncryptedOpenRouterKey` and `openOpenRouterKey(tenantId: string, value: EncryptedOpenRouterKey, wrappingKey: Buffer): string`. Produce `WorkflowService.openRouterConnection(context): Promise<OpenRouterConnectionStatus>` and an admin-only `WorkflowService.configureOpenRouter(context, key, expectedVersion, idempotencyKey): Promise<OpenRouterConnectionStatus>`. The browser API exposes a dedicated tenant-scoped secret POST and redacted status projection. The secret POST must not call `decodeCommandArguments` or store the raw body in a command envelope or receipt. Start with these exact data shapes:

```ts
interface EncryptedOpenRouterKey {
  keyVersion: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}

interface OpenRouterConnectionStatus {
  state: 'not-configured' | 'ready' | 'invalid-credential' | 'disabled' | 'unavailable';
  version: number;
  lastVerifiedAt?: string;
}
```

- [ ] **Step 1: Write a failing boundary check.** Add Vitest cases that seal/open under the same tenant, reject a different tenant as authenticated-data mismatch, deny non-admin submission, and verify no response/projection contains a sentinel key string. Use a fixed test wrapping key and no real provider key. Stub `GET /api/v1/key` with a successful redacted response; assert unsuccessful verification does not create a ready record.
- [ ] **Step 2: Run the focused tests and confirm failure.** Run `corepack pnpm vitest run packages/workflow/src/openrouter-connection.test.ts packages/browser/src/local-browser-host.test.ts` and confirm missing interface/route failures.
- [ ] **Step 3: Implement the minimal secure path.** Use `randomBytes(12)`, `createCipheriv('aes-256-gcm', ...)`, `setAAD(Buffer.from(tenantId + ':openrouter'))`, and the matching decipher path. Validate a 32-byte wrapping key at startup. Add a single workflow record kind with ciphertext, nonce, tag, key version, status and timestamps. Add the SQL kind migration after inspecting the current 007 constraint. The dedicated route reuses `BrowserV1Transport.context`, `assertOrigin`, tenant path matching, admin profile assertion, expected-version check and bounded body. Verify against OpenRouter's current-key endpoint before replacing a ready record, then encrypt before writing. Return metadata only. Keep the generic command decoder's forbidden-key rule intact. Derive the stable write digest with HMAC over action, tenant, expected version, and supplied key using a server-only key; never use the generic command digest of raw arguments.
- [ ] **Step 4: Verify behavior.** Re-run the focused tests, `corepack pnpm typecheck`, and the browser contract tests. Assert that SQL receives ciphertext but no plaintext, the projection rejects secret-bearing fields, and the Azure starter path still works.
- [ ] **Step 5: Commit this slice.** Stage only Task 1 files and commit after inspecting the staged diff; leave unrelated SQL edits unstaged.

### Task 2: Reverify, rotate, and disconnect the tenant key

**Files:** Modify `packages/workflow/src/openrouter-connection.ts`, `packages/workflow/src/service.ts`, `packages/browser/src/index.ts`, `packages/browser/src/local-browser-host.ts`, `apps/browser/src/platform-api.ts`, `apps/browser/src/platform-app.tsx`; test `packages/workflow/src/openrouter-connection.test.ts`, `packages/browser/src/local-browser-host.test.ts`.

**Interfaces:** Consume Task 1 ciphertext/status and dedicated route. Produce admin-only reverify, rotate, and disconnect operations; all return `OpenRouterConnectionStatus`. Reverify uses OpenRouter `GET /api/v1/key` with a bounded timeout and maps HTTP/network results to safe categories. Only successful verification can mark a candidate key ready.

- [ ] **Step 1: Write failing lifecycle tests.** Cover wrong key preserving the previous ready connection, successful rotation changing version, stale concurrent rotation, idempotent retry, disconnect denying later resolution, tenant isolation, and absent wrapping-key configuration failing closed.
- [ ] **Step 2: Run focused tests and confirm failure.** Run `corepack pnpm vitest run packages/workflow/src/openrouter-connection.test.ts packages/browser/src/local-browser-host.test.ts`.
- [ ] **Step 3: Implement lifecycle and admin UI.** Reverify only the current encrypted key, without returning the upstream body. Rotate by using Task 1's verified submission with expected version and stable HMAC digest. Disconnect clears active ciphertext from the current record. Add a Provider Connections section showing status, last verification and approved model metadata; hold input only while entering/submitting it, clear on tenant switch or completion, and show actionable safe errors. Avoid `PlatformApi.command` for key bytes because its retry map keys on JSON arguments.
- [ ] **Step 4: Verify behavior.** Re-run focused tests and `corepack pnpm typecheck`; manually check one-time input clearing, keyboard labels/focus, wrong-key errors, and a second tenant session.
- [ ] **Step 5: Commit this slice.** Stage only the lifecycle and UI files after inspecting the diff.

### Task 3: Run OpenRouter with the tenant's current credential

**Files:** Modify `packages/workflow/src/ports.ts`, `packages/workflow/src/runtime.ts`, `packages/workflow/src/service.ts`, `packages/browser/src/local-browser-host.ts`, `azure-functions/src/functions/workflow-run.ts`; test `packages/workflow/src/workflow-e2e.test.ts`, `packages/workflow/src/graph.test.ts`.

**Interfaces:** Consume Task 1/2 redacted connection and decrypt resolver. Keep `ModelRequest` credential-free. Change `HttpModelPort` construction to receive a server-only resolver for `(tenantId, 'openrouter')`, with no global-key fallback. Preserve the Azure OpenAI summary path.

- [ ] **Step 1: Write failing runtime tests.** With two test tenants and keys, assert each outgoing Authorization header uses only its own key; missing/disabled connection dispatches no request; an existing published definition fails closed after disconnect; Azure summary still uses Azure headers. Assert upstream error bodies are absent from stored run events.
- [ ] **Step 2: Run the focused tests and confirm failure.** Run `corepack pnpm vitest run packages/workflow/src/workflow-e2e.test.ts packages/workflow/src/graph.test.ts`.
- [ ] **Step 3: Implement the resolver wiring.** Construct the resolver with the worker's `AzureSqlWorkflowStore` and versioned wrapping keys, read by trusted `tenantId` immediately before OpenRouter dispatch, and reject unavailable state. Remove the adapter's reads of `OPENROUTER_API_KEY` and `WORKFLOW_OPENROUTER_TENANTS` once the resolver is in use. Keep existing node deadlines, retry/circuit behavior, and output/schema validation.
- [ ] **Step 4: Verify behavior.** Re-run focused tests, `corepack pnpm typecheck`, and the Azure build. Check a rotated key is used by the next attempt and an already-dispatched call is not replayed by rotation.
- [ ] **Step 5: Commit this slice.** Stage only Task 3 files after inspecting the diff.

### Task 4: Select and publish only approved exact Agent models

**Files:** Modify `packages/workflow/src/graph.ts`, `packages/workflow/src/service.ts`, `packages/workflow/src/ports.ts`, `packages/browser/src/local-browser-host.ts`, `apps/browser/src/platform-app.tsx`, `apps/browser/src/workflow-model.ts`, `docs/diagram-workflow-v1-decisions.md`; test `packages/workflow/src/graph.test.ts`, `packages/workflow/src/workflow-e2e.test.ts`, `apps/browser/src/workflow-model.test.ts`.

**Interfaces:** Consume tenant connection readiness from Tasks 1–3. Produce a server-owned allow-list of exact OpenRouter IDs with conservative per-model cost rates. `WorkflowService.check` returns field-level `GraphIssue`s; `publish` rechecks connection/model state and pins the existing graph fields. The runtime checks that pinned model/fallback remain permitted and uses their conservative rate.

- [ ] **Step 1: Write failing policy tests.** Cover absent connection, unverified key, unapproved alias/model/fallback, absent `openRouterOptIn`, unsupported structured-output capability, stale check/publish, post-publication policy removal, and unchanged Azure OpenAI starter. Use exact test model IDs such as `openai/gpt-4.1-mini`.
- [ ] **Step 2: Run focused tests and confirm failure.** Run `corepack pnpm vitest run packages/workflow/src/graph.test.ts packages/workflow/src/workflow-e2e.test.ts apps/browser/src/workflow-model.test.ts`.
- [ ] **Step 3: Implement policy and inspector controls.** Load a validated server allow-list whose entries include exact ID, structured-output certification, and upper-bound cost per 1K tokens. Reject aliases/moving targets. Use the same policy in check, publish, and worker dispatch. Show provider, exact model, allowed same-provider fallback, response schema, opt-in, and Node policy as typed live Agent fields. Preserve existing memory controls and publish digest flow; record decisions in the workflow decision document.
- [ ] **Step 4: Verify behavior.** Run focused tests, `corepack pnpm typecheck`, `corepack pnpm build:azure`, and browser build. Perform a deployed admin-key + editor-publish + run smoke test with a limited tenant key; inspect only redacted status and run results.
- [ ] **Step 5: Commit this slice.** Stage only Task 4 files after inspecting the diff.

## Rollout gate

Provision versioned wrapping-key configuration and the certified exact-model allow-list in the Azure Functions environment before exposing connection UI. Apply the SQL migration after checking the latest migration sequence. Deploy the server path before Agent controls. Exercise tenant isolation, rotation, disconnection, and one real limited-key run. If rollback is needed, hide OpenRouter controls and deny OpenRouter dispatch while retaining ciphertext and old wrapping-key versions for recovery.
