# 04 — Author and publish a permitted OpenRouter Agent

**What to build:** An editor can choose OpenRouter and a permitted exact model in the live Agent inspector, understand connection readiness, and publish a checked definition with the selected model, fallback, schema, and Node policy pinned.

**Blocked by:** 01 — Configure a verified tenant OpenRouter connection; 03 — Dispatch an approved OpenRouter model with the tenant key.

**Status:** complete

- [x] The live Agent inspector exposes typed provider, exact model, optional same-provider fallback, response schema, opt-in, and Node policy fields; it never asks for a raw key.
- [x] Check shows actionable issues for absent/unverified/disabled connection, missing opt-in, unapproved model/fallback, or unsupported structured output.
- [x] Publish rechecks readiness and current draft revision, pins exact settings, and rejects stale or denied state.
- [x] Azure OpenAI remains the starter/default and continues through check, publish, and run.

## Implementation path

The live Agent currently renders `AgentMemorySettings` in `apps/browser/src/platform-app.tsx`; add provider/model/policy controls alongside it, using `workflow-model.ts` starter config and `updateNode`. Obtain safe connection/model metadata through the new browser projection. Keep `AgentMemorySettings` intact. `packages/workflow/src/graph.ts` already permits `provider: 'openrouter'`, exact `model`, `fallback`, `openRouterOptIn`, response schema, and policy. Tighten exact model validation at the server boundary, then use `WorkflowService.providerIssues`, `check`, and `publish` in `service.ts` to enforce the same readiness and allow-list as ticket 03. Existing `workflow.check` and `workflow.publish` commands in `packages/browser/src/workflow-commands.ts` and `PlatformApi.command` remain the authoring path; drafts and definitions must never contain the connection key. Record final policy in `docs/diagram-workflow-v1-decisions.md`.

## Blast radius and verification

Agent config is also used by fixture starter content, draft save/load, graph validation, run execution, Condition field selection, and memory proposals. Verify selected controls survive save/load and tenant switch, unchanged Azure starter publishes, rejected aliases and fallback fail before publish, and a successful OpenRouter run uses ticket 03's tenant resolver. Check missing connection, rotating/disabled connection between check and publish, stale revision, cost bound, and safe field-level issue rendering. Do not present provider readiness based solely on the presence of a global environment key.

## Completed

The safe `openrouter-models` projection exposes only configured exact model slugs and structured-output support. `WorkflowService` rereads connection state and the catalog at check and publish; the worker still resolves the current tenant key immediately before dispatch. Focused typechecking and graph/workflow tests pass.
