# Container Apps hosting and Grafana Cloud

Date: 2026-10-06. Supersedes the backend hosting parts of `2026-10-06-azure-vercel-deployment-design.md` (Flex Consumption, zip deploy, "Container Apps out of scope"). Everything else in that spec stands.

## Goal

Run the Azure Functions API as a container on Azure Container Apps (Consumption profile), for staging and prod, with total Azure spend at or under $1 per month. GitHub Actions keeps deploying through OIDC. Telemetry and governance reads go to Grafana Cloud.

## Why

The subscription cannot create Flex Consumption (`FC1`) or Consumption (`Y1`) plans in any region (`ServerFarmCreationNotAllowed`). `F1` refuses Functions and `B1` costs about $13 per month. `Microsoft.Web/sites` with `managedEnvironmentId` passed `az deployment group validate` on 2026-10-06 (0.5 vCPU / 1 GiB, `Microsoft.App` registered). Preflight passing is not proof; the first staging deploy is the integration test.

## Decisions

| Topic | Decision |
|---|---|
| Host | `Microsoft.Web/sites`, `kind: functionapp,linux,container,azurecontainerapps`, in a `Microsoft.App/managedEnvironments` on the Consumption workload profile. Azure auto-configures KEDA scalers for HTTP, timer and Durable storage queues. |
| Size and scale | 0.5 vCPU / 1 GiB (platform minimum is 0.5 vCPU), `minimumElasticInstanceCount: 0`, `functionAppScaleLimit: 2`. |
| Image | `ghcr.io/<owner>/<repo>-api`, built on `main`, tagged with the commit SHA. Public package, so no pull secret. The image holds compiled code only. |
| Rollout | The Bicep deploy with `imageTag=<sha>` is the rollout. Rollback is redeploying an older SHA. No separate code-deploy step. |
| Timer | Scale-to-zero cannot fire timers. `wake.yml` requests the API every 6 hours per environment. The host starts, sees the missed `workflowDispatchRecovery` slot and runs it as past-due. No new route: an unauthenticated `GET /api/v1/tenants` answers 401 and still wakes the host. |
| Durable | Orchestrations wake through the KEDA storage-queue scaler. Long Durable timers can start late when the app is at zero. Accepted. |
| Secrets | Key Vault references through the system identity, as today. New: OTLP header and Grafana query token. |
| Telemetry | One free Grafana Cloud stack for both environments, separated by `deployment.environment.name` (`DEPLOYMENT_ENVIRONMENT`). |

## Azure resources (`infra/main.bicep`)

- Remove: Flex `serverfarms`, `functionAppConfig`, the `app-package` container and its role use.
- Add: `managedEnvironments` (Consumption profile, logs to the shared Log Analytics workspace).
- `Microsoft.Web/sites`: image `ghcr.io/...:<imageTag>`, system identity, `resourceConfig` 0.5 / 1Gi.
- Role assignments for storage (blob owner, queue, table) and Key Vault secrets user stay.
- New app settings: `OTEL_EXPORTER_OTLP_ENDPOINT`, `GOVERNANCE_PROMETHEUS_URL`, `GOVERNANCE_LOKI_URL`, `GOVERNANCE_TEMPO_URL`, `GOVERNANCE_ASSISTANT_MAX_COST` (params in `*.bicepparam`); `OTEL_EXPORTER_OTLP_HEADERS`, `GOVERNANCE_QUERY_USER`, `GOVERNANCE_QUERY_TOKEN` (Key Vault references).
- Outputs: `apiHostname` replaces `functionHostname`; `vaultName` and `sqlServerFqdn` stay.

## Image pipeline

- Root `Dockerfile` on `mcr.microsoft.com/azure-functions/node:4-node22`. Copies `host.json`, `package.json`, `dist/` and the production `node_modules` built the way `ci.yml` does today (`pnpm install --prod --config.node-linker=hoisted`).
- `ci.yml`: the `build` job's zip and `functions-zip` artifact are replaced by a Docker build, pushed to GHCR on `main` only (`packages: write`). Pull requests build without pushing.
- `deploy-environment.yml`: drop the artifact download and `Azure/functions-action`; pass `imageTag` (the `sha` input) to `az deployment group create`.

## Grafana Cloud

Owner creates the stack and three tokens: OTLP write, read-only query, dashboard service account.

- Key Vault secrets: `otlp-headers`, `governance-query-user`, `governance-query-token`.
- GitHub: variable `GRAFANA_URL`, secret `GRAFANA_API_TOKEN`.
- Deploy step, after infra and before smoke: for each file in `infra/observability/dashboards/*.json`, `POST $GRAFANA_URL/api/dashboards/db` with `{"dashboard": <file>, "overwrite": true}` (dashboard `id` set to null).
- Smoke gains one check: the governance chart endpoint no longer reports not-configured.

## Cost

Free grant per subscription: 180,000 vCPU-seconds and 360,000 GiB-seconds, about 100 active hours at 0.5 vCPU / 1 GiB, shared by both environments. A 6-hourly wake with the default 5-minute cooldown is about 20 hours a month. Smoke and real traffic add to that. The $1 budget alert is the safety net. Grafana Cloud free limits (10k metric series, 50 GB logs and traces, 14 days) are not billed.

## Failure handling

| Case | Behaviour |
|---|---|
| Cold start after zero | Smoke and migrations already retry; smoke retry window covers container start. |
| `wake.yml` skipped or late | Recovery runs on the next request or wake; the timer slot stays past-due. |
| Image missing in GHCR | Deploy fails at the infra step; staging failure blocks prod. |
| Grafana push fails | Deploy step fails before smoke; dashboards are idempotent so a rerun fixes it. |

## Testing

- `az bicep build` lint (existing `infra-lint`) covers the new template and params.
- vitest: smoke Grafana check; a shape test on `wake.yml` is not added (YAGNI).
- First staging deploy is the integration test; record the result in evidence.

## Out of scope

ACR, custom domains, Grafana alert rules, `minReplicas` above 0, Azure support request for Flex.

## Docs to update when implementing

- `2026-10-06-azure-vercel-deployment-design.md`: Backend runtime row, resource list, build step 4 and the functions-action deploy step, Out of scope line, Flex risk rows.
- `docs/diagram-workflow-v1-decisions.md`: "Azure and Vercel deployment" section.
- `README.md` section 18: hosting row, pipeline, first-time setup (GHCR public flip, Grafana tokens, new Key Vault secrets, `API_ORIGIN`).

## Owner steps added

- Make the GHCR package public after the first push.
- Create the Grafana Cloud stack and tokens; seed the three Key Vault secrets per environment; set `GRAFANA_URL` and `GRAFANA_API_TOKEN` in GitHub.
