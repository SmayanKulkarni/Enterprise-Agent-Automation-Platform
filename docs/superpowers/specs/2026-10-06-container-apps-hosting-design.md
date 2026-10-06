# Container Apps hosting and Grafana Cloud

Date: 2026-10-06 (revised after probing the Container Apps resource shape). Supersedes the backend hosting parts of `2026-10-06-azure-vercel-deployment-design.md` (Flex Consumption, zip deploy, Key Vault, "Container Apps out of scope"). Everything else in that spec stands.

## Goal

Run the Azure Functions API as a container on Azure Container Apps (Consumption profile), for staging and prod, with total Azure spend at or under $1 per month. GitHub Actions keeps deploying through OIDC. Telemetry and governance reads go to Grafana Cloud.

## Why

The subscription cannot create Flex Consumption (`FC1`) or Consumption (`Y1`) plans in any region (`ServerFarmCreationNotAllowed`). `F1` refuses Functions and `B1` costs about $13 per month.

Probes on 2026-10-06 (`az deployment group validate` in `rg-eaa-staging`, `Microsoft.App` registered):
- `Microsoft.App/containerApps@2026-03-02-preview` with `kind: functionapp` passes. This is the documented shape for Functions on Container Apps (Microsoft Learn, "Azure Functions on Azure Container Apps overview").
- `allowScalingRuleOverride: true` is rejected on create (`AllowScalingRuleOverrideNotApplicable`); the documented route is a PATCH after the app exists.
- Minimum size is 0.5 vCPU.

Preflight passing is not proof; the first staging deploy is the integration test.

## Decisions

| Topic | Decision |
|---|---|
| Host | `Microsoft.App/containerApps@2026-03-02-preview`, `kind: functionapp`, system identity, external ingress on port 80, in a `Microsoft.App/managedEnvironments` on the Consumption workload profile. No Log Analytics destination on the environment: the deploy identity has only `Reader` on `rg-eaa-shared` and cannot list workspace keys. Application Insights and Grafana carry telemetry. |
| Size and scale | 0.5 vCPU / 1 GiB, `minReplicas: 0`, `maxReplicas: 2`. |
| Image | `ghcr.io/<owner>/<repo>-api:<commit sha>`, built in `ci.yml`, pushed on `main` only. Public package, so no pull secret. Compiled code only. |
| Rollout | The Bicep deploy with `IMAGE` set is the rollout. Rollback is redeploying an older SHA. Migrations run before the infra step, so new code never starts on an old schema. |
| Timer | Scale-to-zero cannot fire timers. `wake.yml` requests `GET /api/v1/tenants` (answers 401, still starts the host) every 6 hours per environment. The host sees the missed `workflowDispatchRecovery` slot and runs it as past-due. |
| Durable | The platform auto-scaler does not support the Azure Storage Durable provider (only MSSQL and Durable Task Scheduler). The deploy therefore PATCHes `allowScalingRuleOverride: true` with `azure-queue` rules (system identity) on the work-item queue and the four control queues, plus an HTTP rule. `host.json` pins `hubName` so queue names are known. A Bicep PUT resets the override, so the PATCH runs after every infra deploy. |
| Secrets | Container Apps secrets, set from `@secure()` Bicep parameters fed by GitHub environment secrets. Key Vault is dropped: a `keyVaultUrl` secret must already exist when the revision is created, so the first deploy would fail, and the vault, identity role and owner seeding steps buy nothing here. Storage keeps identity auth. |
| Telemetry | One free Grafana Cloud stack for both environments, separated by `deployment.environment.name` (`DEPLOYMENT_ENVIRONMENT`). |
| API origin | The deploy reads `apiHostname` from the Bicep outputs for the Vercel build and smoke. `wake.yml` reads repository variables `STAGING_API_ORIGIN` and `PROD_API_ORIGIN` (a job on the `prod` environment would wait for the reviewer). The `API_ORIGIN` and `FUNCTION_APP_NAME` environment variables go away. |

## Azure resources (`infra/main.bicep`)

- Remove: Flex `serverfarms`, `Microsoft.Web/sites`, `app-package` container, Key Vault and its role.
- Add: `managedEnvironments` and the `containerApps` resource.
- Keep: storage account (shared keys off), roles `blobOwner`, `queueContributor`, `tableContributor` for the app identity, SQL and Application Insights lookups.
- Plain settings: existing ones plus `FUNCTIONS_WORKER_RUNTIME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `GOVERNANCE_PROMETHEUS_URL`, `GOVERNANCE_LOKI_URL`, `GOVERNANCE_TEMPO_URL`, `GOVERNANCE_ASSISTANT_MAX_COST` (omitted when empty).
- Secret settings: `AZURE_SQL_CONNECTION_STRING`, `CLERK_SECRET_KEY`, `WORKFLOW_OPENROUTER_WRAPPING_KEY`, `WORKFLOW_MCP_WRAPPING_KEY`, `OTEL_EXPORTER_OTLP_HEADERS`, `GOVERNANCE_QUERY_USER`, `GOVERNANCE_QUERY_TOKEN`.
- Outputs: `apiHostname`, `appName`, `storageAccountName`, `sqlServerFqdn`.

## Image pipeline

- Root `Dockerfile` on `mcr.microsoft.com/azure-functions/node:4-node22` with `.dockerignore` allowing only `dist`, `host.json`, `package.json`, `node_modules`.
- `ci.yml` `build` job: build, production install (hoisted), `docker build`; on `push` also login to GHCR and push (`packages: write`).
- `deploy-environment.yml`: login, open SQL firewall, migrate, close firewall, Bicep deploy (image pinned to the SHA), scale-rule PATCH, Grafana dashboards, warm-up, Vercel deploy, smoke. The artifact download and `functions-action` steps are removed.

## Grafana Cloud

Owner creates the stack and three tokens: OTLP write, read-only query, dashboard service account.

- GitHub environment variables: `OTEL_EXPORTER_OTLP_ENDPOINT`, `GOVERNANCE_PROMETHEUS_URL` (ends `/api/prom`), `GOVERNANCE_LOKI_URL`, `GOVERNANCE_TEMPO_URL` (ends `/tempo`), `GRAFANA_URL`.
- GitHub environment secrets: `OTEL_EXPORTER_OTLP_HEADERS` (`Authorization=Basic%20<base64 instance:token>`), `GOVERNANCE_QUERY_USER`, `GOVERNANCE_QUERY_TOKEN`. Repository secret: `GRAFANA_API_TOKEN`.
- Deploy step: for each `infra/observability/dashboards/*.json`, `POST $GRAFANA_URL/api/dashboards/db` with `{"dashboard": <file with id null>, "overwrite": true}`.
- Smoke gains three checks (when the variables are present): Prometheus, Loki and Tempo answer 200 to a trivial request with the query credentials. These are the same URLs and credentials the API uses.

## Cost

Free grant per subscription: 180,000 vCPU-seconds and 360,000 GiB-seconds, about 100 active hours at 0.5 vCPU / 1 GiB, shared by both environments. A 6-hourly wake with the default 5-minute cooldown is about 20 hours a month. Smoke, deploys and real traffic add to that. The $1 budget alert is the safety net. Grafana Cloud free limits (10k metric series, 50 GB logs and traces, 14 days) are not billed.

## Failure handling

| Case | Behaviour |
|---|---|
| Cold start after zero | Deploy runs a warm-up request with retries before smoke; tier-two smoke already retries. |
| `wake.yml` skipped or late | Recovery runs on the next request or wake. |
| Image not public or missing in GHCR | Revision fails to provision; the infra step fails; staging failure blocks prod. |
| Scale-rule PATCH fails | Deploy fails; a rerun reapplies it. Without it, Durable work can stall at zero until the next request or wake. |
| Grafana push fails | Deploy step fails before smoke; dashboards are idempotent. |

## Testing

- vitest: smoke Grafana checks; a guard test that `host.json` `hubName` matches the queue names in `infra/scale-rules.jq`.
- `az bicep build` and `build-params` lint (existing `infra-lint`, with the new environment variables).
- Local `docker build` of the image.
- First staging deploy is the integration test; record the result in evidence.

## Out of scope

ACR, custom domains, Grafana alert rules, `minReplicas` above 0, the MSSQL Durable provider, Azure support request for Flex.

## Docs to update when implementing

- `2026-10-06-azure-vercel-deployment-design.md`: Backend runtime row, resource list, build step 4, deploy steps, Out of scope line, Flex risk rows.
- `docs/diagram-workflow-v1-decisions.md`: "Azure and Vercel deployment" section.
- `README.md` section 18.

## Owner steps added

- Make the GHCR package public after the first push on `main`, then rerun the failed deploy.
- Create the Grafana Cloud stack and tokens; set the GitHub variables and secrets above.
- After the first successful deploy, set repository variables `STAGING_API_ORIGIN` and `PROD_API_ORIGIN`.
- Key Vault seeding is no longer needed.
