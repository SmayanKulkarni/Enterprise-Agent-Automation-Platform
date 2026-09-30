# 04 — Telemetry foundation, Browser API signals, and the local stack

**What to build:** A developer runs `docker compose up` in `infra/observability`, sets `OTEL_EXPORTER_OTLP_ENDPOINT`, makes a few API requests, and sees in Grafana: a trace per request, the `http.server.request.duration` histogram, and structured log events. With no telemetry variables set the app behaves exactly as before. Both hosts (Vercel function and Azure Functions) flush before the invocation ends.

**Blocked by:** None — can start immediately.

**Status:** implemented

**Spec:** `docs/superpowers/specs/2026-09-30-governance-observability-design.md` — Unit 2: "`packages/telemetry` (new)", "Metric catalog" (label rules), "Log event catalog", "Traces", the Browser API / Vercel host / Azure host rows of "Where instrumentation lives", "Local stack". "Configuration" rows `OTEL_*` and `DEPLOYMENT_ENVIRONMENT`.

- [x] `packages/telemetry` exports `startTelemetry`, `flushTelemetry`, the instrument catalog and `logEvent`.
- [x] With neither `OTEL_EXPORTER_OTLP_ENDPOINT` nor `APPLICATIONINSIGHTS_CONNECTION_STRING` set, nothing is exported, nothing throws, and every existing test passes unchanged.
- [x] With the OTLP endpoint set, traces, metrics and logs reach it. With the App Insights connection string set, traces still reach App Insights.
- [x] The resource carries `service.name`, `service.namespace = threadline`, `deployment.environment.name`, and a random `service.instance.id` per process.
- [x] `flushTelemetry()` resolves within 2 seconds even when an exporter hangs, and never rejects.
- [x] `logEvent` drops every attribute outside the event's allowlist, scrubs string values, emits an OpenTelemetry log record, and writes the same record as one JSON line to stdout.
- [x] Every Browser API request produces a root span and one `http.server.request.duration` point labelled with a route template from a fixed set, method and status code.
- [x] The `tenant_id` label is set only when the request authenticated for that tenant. A 403 for a random tenant UUID creates no new label value.
- [x] `report()` keeps its current console line and span attributes, and also emits `api.request.failed` and increments `app.errors`.
- [x] 401 and 403 responses increment `auth.denied` and emit the `auth.denied` event. Every command emits `command.executed`.
- [x] `azure-functions/src/telemetry.ts` only calls `startTelemetry`. Activity, HTTP and timer handlers flush before returning. Orchestrator functions emit nothing.
- [x] `api/v1/[...path].ts` starts telemetry before the transport loads and flushes through `waitUntil`.
- [ ] `infra/observability/docker-compose.yml` starts `grafana/otel-lgtm`; the completion notes list the Prometheus metric names observed for every instrument this ticket emits. (Compose file written and validated with `docker compose config`; the stack was not started, so no metric names were observed. See notes.)

## Code map (verified 2026-09-30)

| Where | What is there now |
| --- | --- |
| `azure-functions/src/telemetry.ts` (34 lines) | `NodeTracerProvider`, a `stripQuery` span processor, `SimpleSpanProcessor(AzureMonitorTraceExporter)`, tedious, undici and Azure Functions instrumentations, service name `workflow-functions`. Runs only when the App Insights string is set |
| `azure-functions/src/index.ts:1` | `import './telemetry.js'` is the first import. Keep it first |
| `azure-functions/src/functions/workflow-run.ts:11-13` | `logged(site, handler)` wraps every activity except `workflowDefinitionStart` (line 53) |
| `azure-functions/src/functions/browser-api.ts`, `workflow-agent.ts`, `workflow-webhook.ts`, `workflow-dispatch-recovery.ts` | HTTP and timer handlers |
| `api/v1/[...path].ts` | `export default { fetch: (request: Request) => browserResponse(request) };` |
| `apps/browser/vite.config.ts` | Dev middleware serves `/api/v1` through one long-lived `localBrowserTransport` |
| `packages/errors/src/report.ts` | `report(error, context)`; module-private `scrub` (line 9); console JSON line (24); active-span attributes (26-28) |
| `packages/browser/src/index.ts:154-170` | `handle()`; `errorContext()` at 211 takes the tenant from the URL, before authentication |
| `packages/browser/src/index.ts:174` | `context()` is where a tenant becomes authenticated |
| Root `package.json` | `@opentelemetry/api ^1.9.1`, `instrumentation ^0.222.0`, `instrumentation-tedious`, `instrumentation-undici`, `resources ^2.11.0`, `sdk-trace-node ^2.11.0`; dev `sdk-trace-base ^2.11.0` |
| `tsconfig.json` | `include` already covers `packages/**/*.ts`. There is no root Vitest config; defaults apply |
| `infra/` | Holds `main.bicep` only |

## Implementation path

### 1. Dependencies

Add to the root `package.json`: `@opentelemetry/sdk-metrics`, `@opentelemetry/sdk-logs`, `@opentelemetry/api-logs`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/exporter-metrics-otlp-http`, `@opentelemetry/exporter-logs-otlp-http`, `@vercel/functions`.

Pick versions from the same release line as the installed packages: the stable line that matches `sdk-trace-node ^2.11.0`, the experimental line that matches `instrumentation ^0.222.0`. Confirm with `corepack pnpm view <package> versions` and the package peer ranges before installing. Nothing else: no logging library, no Prometheus client.

### 2. `packages/telemetry/src/`

`index.ts`

```ts
export function startTelemetry(serviceName: string, instrumentations: readonly Instrumentation[] = []): void
export function flushTelemetry(): Promise<void>
```

- Calling `startTelemetry` twice is a no-op the second time.
- Trace: `NodeTracerProvider` with `stripQuery` (moved here from the Azure file), plus `SimpleSpanProcessor(OTLPTraceExporter)` when the endpoint is set and `SimpleSpanProcessor(AzureMonitorTraceExporter)` when the App Insights string is set.
- Metrics: `MeterProvider` with a `PeriodicExportingMetricReader` over the OTLP metric exporter, interval 15 s. The serverless hosts rely on `flushTelemetry`; the interval is what makes the long-lived Vite dev server export.
- Logs: `LoggerProvider` with `SimpleLogRecordProcessor(OTLPLogExporter)`.
- Register all three as the global providers. Register tedious and undici plus the instrumentations passed in.
- `flushTelemetry`: `Promise.race([Promise.allSettled([the three forceFlush calls]), a 2000 ms timer])`, wrapped so it cannot reject.
- Exporters read the endpoint and headers from the standard `OTEL_EXPORTER_OTLP_*` variables themselves. Do not parse headers by hand.

`instruments.ts` — the fixed catalog from the spec's "Metric catalog" table: names, types, units. One constraint decides its shape: `@opentelemetry/api` has a proxy for tracers but not for meters, so an instrument created before the global `MeterProvider` is registered stays a no-op forever. Create instruments on first use, not at module load. Prove it with the test in seam 2. Define every instrument in the catalog now, including the ones tickets 06 and 07 will record, so the catalog is fixed in one place.

`events.ts`

```ts
export const EVENTS = { … } as const;
export type EventName = keyof typeof EVENTS;
export function projectEvent(name: string, attributes: Readonly<Record<string, unknown>>): Record<string, string | number | boolean> | undefined
export function logEvent<Name extends EventName>(name: Name, attributes: Partial<Record<(typeof EVENTS)[Name][number], string | number | boolean>>, level?: 'info' | 'warn' | 'error'): void
```

`EVENTS` is the allowlist. These keys are canonical; later tickets and the read side use them as written:

| Event | Allowed attribute keys |
| --- | --- |
| `api.request.failed` | `tenant_id, route, method, status, code, category, correlation_id` |
| `auth.denied` | `route, reason` |
| `command.executed` | `tenant_id, owner, name, outcome, actor_user_id, object_id` |
| `run.started` | `tenant_id, run_id, definition_id, trigger, owner_id` |
| `run.finished` | `tenant_id, run_id, definition_id, status, reason, duration_s, tokens, cost` |
| `node.failed` | `tenant_id, run_id, node_id, node_kind, code` |
| `approval.requested` | `tenant_id, run_id, node_id, kind, capability, expires_at` |
| `approval.decided` | `tenant_id, run_id, decision, actor_user_id, wait_s` |
| `approval.expired` | `tenant_id, run_id, node_id` |
| `model.call` | `tenant_id, run_id, node_id, provider, model, attempt, outcome, tokens, cost, duration_s` |
| `mcp.call` | `tenant_id, run_id, node_id, capability, route, outcome, duration_s, effect_id` |
| `circuit.transition` | `tenant_id, kind, state` |
| `webhook.delivery` | `tenant_id, definition_id, outcome` |
| `connector.request` | `tenant_id, installation_id, operation, outcome` |
| `memory.retrieval` | `tenant_id, run_id, node_id, status, item_count` |
| `group.changed` | `group_id, action, actor_user_id, subject_id` |
| `assistant.asked` | `group_id, billing_tenant_id, provider, model, tokens, cost, outcome` |

- `projectEvent` returns only allowlisted keys whose values are finite numbers, booleans, or strings (scrubbed and cut to 200 characters). An unknown event name returns `undefined`. The read side reuses it in ticket 11.
- `logEvent` calls `projectEvent`, emits a log record (`body` is the event name; attributes are `event`, `level` and the projected keys) and writes `JSON.stringify({ event, level, at, ...projected })` with `console.log`.

`browser-api.ts` — a side-effect module containing `startTelemetry('browser-api')`. Entry points import it first, the way `azure-functions/src/index.ts` imports `./telemetry.js` first, so the tedious and undici patches are in place before `mssql` loads.

### 3. `packages/errors`

- Move `SECRET` and `scrub` into `packages/errors/src/scrub.ts` and export them. `report.ts` and `packages/telemetry` both import from there. `scrub.ts` imports nothing, so there is no cycle.
- `report()`: after the console line, call `logEvent('api.request.failed', …)` with level `error` for status 500 and above, else `warn`; and increment `app.errors` with `code`, `category`, `site`.
- Add `tenantVerified?: boolean` to `ErrorContext`. The counter takes `tenant_id` only when the context has a `site` (worker call sites pass a trusted tenant) or `tenantVerified` is true. The log line and the span attribute keep the tenant as today.

### 4. Browser transport

In `BrowserV1Transport.handle`:

- Wrap the body in `tracer.startActiveSpan('browser.request', …)`. Attributes: method, route template, status code, correlation id, and `tenant_id` when verified.
- Route template: one string from a fixed set, chosen from the branch that matched — `/api/v1/session`, `/api/v1/tenants`, `/api/v1/tenants/:tenantId/:collection`, `/api/v1/tenants/:tenantId/commands/:owner/:name`, `/api/v1/tenants/:tenantId/openrouter-connection`, `/api/v1/tenants/:tenantId/events`, `/api/v1/groups`, `/api/v1/groups/:groupId/:collection`, `/api/v1/groups/:groupId/commands/governance/:name`, `/api/v1/groups/commands/governance/create-group`, `/api/v1/groups/:groupId/assistant`, else `unmatched`. Never put a raw path into a label.
- Remember the verified tenant per request the way `#correlations` remembers the correlation id: set it where `identity.authenticate` succeeds. Use it for the histogram label and for `tenantVerified` in `errorContext`.
- Record `http.server.request.duration` in seconds, once per request, in a `finally`.
- Status 401 or 403: increment `auth.denied` with `reason` equal to the error code, and emit `auth.denied` with the route template.
- Tenant commands, and group commands if that path exists: after the handler settles emit `command.executed` with `outcome` `ok` or the error code, `actor_user_id`, and `object_id` when the receipt has a string `objectId`. For group commands also emit `group.changed` if ticket 02 left it out (read its completion notes).

### 5. Hosts

- `azure-functions/src/telemetry.ts`: `startTelemetry('workflow-functions', [new AzureFunctionsInstrumentation()])` and nothing else.
- Export `withFlush(handler)` from `packages/telemetry`: it awaits the handler and calls `flushTelemetry()` in a `finally`. Apply it inside `logged` (`workflow-run.ts`), to `workflowDefinitionStart`, and to the four HTTP and timer handlers. Do not touch orchestrator generator functions.
- `api/v1/[...path].ts`: import `packages/telemetry/src/browser-api.js` first, then `export default { fetch: async (request: Request) => { try { return await browserResponse(request); } finally { waitUntil(flushTelemetry()); } } };`
- `apps/browser/vite.config.ts`: import the same side-effect module first.

### 6. Local stack

`infra/observability/docker-compose.yml`: one service using `grafana/otel-lgtm`, publishing Grafana `3000`, OTLP/HTTP `4318`, and the Prometheus, Loki and Tempo query ports the image exposes. Mount `./dashboards` read-only at the image's dashboard provisioning path. Check the ports and the path in the image README (https://github.com/grafana/docker-otel-lgtm); do not guess them. Create `infra/observability/dashboards/.gitkeep`. Do not add a README under `infra/`: `.gitignore` ignores every `README.md` except the root one. Put the start command and the local variables (`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`, and the three `GOVERNANCE_*_URL` values ticket 10 will read) in the completion notes; ticket 18 writes them into the root README.

New test files go next to the code in `packages/*/src/`. The top-level `tests/` folder is git-ignored for new files.

## TDD seams

1. `packages/telemetry/src/events.test.ts` — `logEvent` drops a key outside the allowlist; scrubs `Bearer abc` inside a string; drops `Infinity`; writes exactly one stdout line; `projectEvent` returns `undefined` for an unknown event.
2. `packages/telemetry/src/instruments.test.ts` — import the catalog, then register a `MeterProvider` with an in-memory reader, record one point, and read it back. This fails if instruments are created at import time.
3. `packages/telemetry/src/index.test.ts` — `startTelemetry` with an empty environment registers nothing and does not throw; `flushTelemetry` resolves in about 2 s with a never-resolving processor and resolves when a processor rejects.
4. `packages/errors/src/report.test.ts` (extend the existing file if there is one) — `report()` emits `api.request.failed` once per error and no tenant label without `site` or `tenantVerified`.
5. `packages/browser/src/index.test.ts` — with in-memory span and metric exporters: a projection request yields one span and one histogram point with `http.route = /api/v1/tenants/:tenantId/:collection` and the tenant label; a 403 for a random tenant yields a point with no tenant label and an `auth.denied` increment; an unknown path is labelled `unmatched`; a command emits `command.executed`.

## Checks

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test && corepack pnpm build:azure`
- `corepack pnpm --dir apps/browser --ignore-workspace build`
- Manual, if Docker is available: `docker compose -f infra/observability/docker-compose.yml up -d`, start the dev server with the OTLP endpoint set, make several API requests including a failing one, then query Prometheus for the request-duration count series and Loki for `api.request.failed`. Copy the observed Prometheus metric and label names into the completion notes. If Docker is not available, say so.

## Out of scope

Model and MCP signals (06). Workflow run signals (07). Query clients and panels (10, 11). Dashboards and README (18). Browser-side RUM (deferred in the spec).

## Implementation prompt

```text
/mattpocock-skills:implement .scratch/governance-observability/issues/04-telemetry-foundation-and-api-signals.md

<context>
You are implementing ticket 04 of the Governance feature in the Threadline repo at "/media/smayan/500GB SSD/Full Stack" (quote the path). Today the only telemetry is OpenTelemetry traces from the Azure Functions host to Application Insights. This ticket creates packages/telemetry (traces, metrics and logs over OTLP), instruments the Browser API transport, wires both serverless hosts, and adds a local Grafana stack.

Three facts about the deployment shape drive the design, so keep them in mind for every choice:
1. Both hosts are serverless. The process can be frozen the moment the response is sent, so data must be flushed before the handler returns. That is why span and log processors are the "simple" kind and why flushTelemetry exists.
2. Many short-lived processes each start their counters at zero. A random service.instance.id per process lets Prometheus treat each as its own series.
3. Metric labels become time series. A label value that an unauthenticated caller can choose (a tenant id from the URL, a raw path) is a way to create unlimited series. Labels come only from fixed sets or from values verified by authentication.
</context>

<read_first>
1. The ticket file named above. It contains the event allowlist table; those key names are the contract for five later tickets.
2. The spec, Unit 2: docs/superpowers/specs/2026-09-30-governance-observability-design.md
3. azure-functions/src/telemetry.ts and azure-functions/src/index.ts (the existing setup you are replacing).
4. packages/errors/src/report.ts (30 lines).
5. packages/browser/src/index.ts lines 150-220.
6. Current OpenTelemetry JS docs for the SDK packages you add. Use the Context7 docs tool or the vendor docs to confirm constructor options for MeterProvider, LoggerProvider, PeriodicExportingMetricReader and the OTLP HTTP exporters at the versions you install. These APIs changed between major versions; do not write them from memory.
Use `graphify query "what imports report.js"` to see every call site of report() before changing ErrorContext.
</read_first>

<how_to_work>
AGENTS.md applies: ponytail ladder, no code comments, no dependency beyond the seven named in the ticket.

Work in this order and keep the suite green after each step:
1. packages/telemetry with seams 1-3. Pure package, no callers yet.
2. Move scrub, extend report() (seam 4).
3. Instrument the transport (seam 5).
4. Hosts and the Vercel entry. Run corepack pnpm build:azure.
5. Docker compose and the manual check.

For each seam write the failing test first, through the public function named in the seam.
</how_to_work>

<decisions_already_made>
- Instruments are created on first use, because the metrics API has no proxy provider. Seam 2 is the proof.
- startTelemetry takes extra instrumentations as a parameter, so packages/telemetry does not depend on the Azure Functions instrumentation package.
- Telemetry starts from a side-effect module imported first by each entry point, so module patching happens before mssql and undici load.
- The metric reader exports every 15 s for the dev server; serverless hosts rely on the explicit flush.
- report() writes its existing console line and logEvent writes its own line. Two lines per error is accepted by the spec.
- tenant_id on http.server.request.duration and app.errors comes only from a verified source.
</decisions_already_made>

<traps>
- With no telemetry environment variables, no provider may be registered and no network call may happen. The whole existing test suite runs in that mode.
- flushTelemetry must never reject and never take longer than 2 s. A thrown flush error would turn a successful request into a failure.
- Do not emit anything from Durable Functions orchestrator generator functions. They replay, which would duplicate every point.
- canonicalJson and the OTLP exporters both reject or mangle non-finite numbers. projectEvent drops them.
- The Vercel function file must keep its default export shape `{ fetch }`.
- Do not log request bodies, tokens, prompts or argument values anywhere. The allowlist is the only gate; do not add an escape hatch.
- Do not copy real values from .env files into example files.
</traps>

<done_when>
All acceptance boxes hold; corepack pnpm typecheck, lint, test and build:azure pass; the browser app builds. If Docker is available you ran the manual check and recorded the Prometheus metric names. If not, the completion notes say the stack was not exercised.
</done_when>

<report>
Tick the boxes, set Status to "implemented", append "Completion notes": installed versions, observed Prometheus metric and label names (ticket 10 depends on them), the confirmed otel-lgtm ports and dashboard mount path, what was not verified, deviations. Commit on the current branch with a conventional commit message.
</report>
```

## Completion notes

Installed versions: `@opentelemetry/sdk-metrics ^2.11.0` (2.11.0), `sdk-logs`, `api-logs`, `exporter-trace-otlp-http`, `exporter-metrics-otlp-http`, `exporter-logs-otlp-http` all `^0.222.0` (0.222.0, the same line as `instrumentation ^0.222.0`), `@vercel/functions ^3.9.9`. Nothing else was added. Constructor options were read from the installed `.d.ts` files (`LoggerProvider({ processors })`, `SimpleLogRecordProcessor({ exporter })`, `PeriodicExportingMetricReader({ exporter, exportIntervalMillis, exportTimeoutMillis })`).

Verified (run locally):
- `corepack pnpm typecheck`, `corepack pnpm test` (68 files, 481 tests), `corepack pnpm build:azure` and `corepack pnpm --dir apps/browser --ignore-workspace build` pass. ESLint reports nothing on the files this ticket adds or edits (`azure-functions/` is outside the ESLint project, as before).
- Seam 1-3 (`packages/telemetry/src/*.test.ts`): allowlist, scrub, non-finite drop, one stdout line, log record body/attributes; instruments created after the provider registers; a real local OTLP/HTTP server receives `/v1/traces`, `/v1/metrics` and `/v1/logs` with `service.name`, `service.namespace`, `deployment.environment.name` and a distinct `service.instance.id` per process; `flushTelemetry` resolves in about 2 s against a server that never answers; empty environment registers nothing and creates only non-recording spans.
- Seam 4 (`packages/errors/src/report.test.ts`): one `api.request.failed` per error (warn for 4xx, error for 5xx); `app.errors` has a tenant label only with `site` or `tenantVerified`.
- Seam 5 (`packages/browser/src/index.test.ts`): one root span and one duration point per request; tenant label only after authentication; a 403 for a random tenant UUID creates no tenant label; `auth.denied` counter and event; `unmatched` for unknown paths; every route template; `command.executed` for tenant and group commands; `group.changed` for group commands; `onError` receives `tenantVerified` only after the tenant authenticated.

Not verified:
- The local stack was not started: the Docker daemon is not running here. `docker compose -f infra/observability/docker-compose.yml config` validates. No Prometheus metric or label names were observed, so the box above is open. Expected names from the OTel to Prometheus translation (unconfirmed): `http_server_request_duration_seconds_{bucket,count,sum}` with labels `http_route`, `http_request_method`, `http_response_status_code`, `tenant_id`; `app_errors_total`; `auth_denied_total`. Ticket 10 must confirm them against a running stack first.
- Application Insights export: only that the tracer provider records spans with the connection string set. The Azure exporter refuses a plain-HTTP endpoint, so it cannot be tested against a local server.
- `waitUntil` on Vercel and the Azure handler wrappers ran only through `tsc`; they were not run on either host.

Confirmed otel-lgtm facts (grafana/docker-otel-lgtm README and Dockerfile): Grafana 3000, OTLP gRPC 4317, OTLP HTTP 4318, Prometheus 9090, Tempo 3200, Pyroscope 4040; Loki listens on 3100 inside the container but the Dockerfile does not `EXPOSE` it, so the compose file publishes it explicitly. Dashboards mount at `/otel-lgtm/grafana/conf/provisioning/dashboards/custom`; Grafana only loads them when a provisioning YAML is mounted too (README "Add custom dashboards"), which is left to ticket 18.

Local use (ticket 18 writes it into the root README). All ports bind to 127.0.0.1; the image has no authentication.

```sh
docker compose -f infra/observability/docker-compose.yml up -d
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 DEPLOYMENT_ENVIRONMENT=development corepack pnpm --dir apps/browser --ignore-workspace dev
GOVERNANCE_PROMETHEUS_URL=http://localhost:9090
GOVERNANCE_LOKI_URL=http://localhost:3100
GOVERNANCE_TEMPO_URL=http://localhost:3200
```

Grafana: http://localhost:3000 (admin / admin).

Deviations and notes:
- API of `instruments.ts`: `count(name, labels?, value?)` and `record(name, value, labels?)`, exported from `packages/telemetry/src/index.js` and typed per metric. Labels outside a metric's catalog entry are dropped and string labels are scrubbed and cut to 128 characters, so a run id cannot become a series. Tickets 06 and 07 call these two functions. Histograms carry explicit bucket boundaries (seconds, or tokens); the OTel defaults are millisecond-scaled.
- Instruments are cached per global `MeterProvider`; a new provider rebuilds them. Found by a failing test, not by reading.
- `logEvent` and `count` accept `undefined` attribute values, which are skipped, so callers do not need conditional spreads.
- `DEPLOYMENT_ENVIRONMENT` unset gives `unknown`, not `development`, so a production process never mislabels itself.
- `startTelemetry` catches a construction failure (for example an invalid endpoint), prints one `telemetry.disabled` line and leaves the app running.
- The route template comes from `tenantRoute()` in the transport, which the tenant dispatch chain then switches on, so the label and the branch cannot drift apart. A request that fails id validation still carries its template.
- `auth.denied` `reason` is the internal error code (`DENIED`, `UNAUTHENTICATED`, `TENANT_MISMATCH`, `INVALID_IDENTIFIER`); the response body still shows `DENIED` for every 403.
- `command.executed` is emitted only after the handler was reached, so argument validation failures and the stale-epoch guard before the handler do not produce it. `group.changed` is now wired (ticket 02 left it for this ticket). It fires for every successful handler result, including an idempotent replay, because the handler returns only the receipt.
- The tenant label on `http.server.request.duration` is set on tenant routes and on `/api/v1/session` (authenticated for the tenant the session resolves), not on `/api/v1/tenants`.
- The Azure invocation span itself ends after the handler returns, so it can miss the in-handler flush; spans created inside the handler are flushed.
