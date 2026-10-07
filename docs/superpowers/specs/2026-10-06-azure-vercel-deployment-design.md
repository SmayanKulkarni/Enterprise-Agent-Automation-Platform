# Azure + Vercel deployment, CI/CD, and post-deploy testing

> Backend hosting, secrets and the Functions deploy path are superseded by `2026-10-06-container-apps-hosting-design.md` (Flex Consumption is unavailable on this subscription). The rest of this spec stands.

Date: 2026-10-06
Status: design approved in brainstorming; awaiting spec review

## Goal

Make the platform deployable and repeatable: backend on Azure Functions, frontend on Vercel, Azure SQL migrated automatically, every change verified in CI, and every deploy smoke-tested against live URLs. Two environments (staging, prod). Total Azure spend stays at or under **$1 per month**.

Success means:

- A pull request runs full verification, applies all migrations to a throwaway SQL Server container, and gets a Vercel preview URL.
- A merge to `main` deploys staging (infra, migrations, backend, frontend), smoke-tests it, waits for a manual approval, then deploys and smoke-tests prod.
- All Azure resources except the existing SQL server are reproducible from Bicep.
- No long-lived cloud credential is stored in GitHub; Azure access uses OIDC federation.

## Context and findings

- The previous Azure subscription (Azure for Students, owned by a different account) is disabled and read-only. Its serverless SQL database had auto-pause off, which billed compute continuously.
- The target subscription is `Azure subscription 1` (`8b6932d2-81b6-4307-863b-09213d3f05c8`), tenant Shri Vile Parle Kelavani Mandal. Offer is Pay-As-You-Go with **no spending limit**, so cost controls are design requirements.
- Existing SQL server `auomaionbackenddb` (centralus, resource group `rg-smayan.kulkarni142-9549`) holds `auomation-db` and `automationtestingdb`. Both are serverless `GP_S_Gen5` on the free offer (100k vCore-seconds/month each) with `freeLimitExhaustionBehavior = AutoPause`. They cost $0 and cannot overrun.
- `infra/main.bicep` is a stub. There is no `.github/` directory. Vercel deploys have been CLI-only; the project has no Git link.
- Vercel currently also serves `api/v1/[...path].ts`, an in-process API (`browserResponse` over `localBrowserTransport`) with Clerk secrets in Vercel env.
- `azure-functions/src/functions/workflow-dispatch-recovery.ts` runs a timer every minute that queries SQL. On free tiers this keeps the Flex Consumption instance alive (about $30/month at 512 MB) and prevents SQL auto-pause, exhausting the free offer within days.
- `tools/sql/azure-sql.mjs` is a forward-only migration runner with SHA-256 digest tracking in `dbo.platform_schema_migrations`. 21 migrations exist. Migrations use `OPENJSON` (SQL Server 2016+). `database/bootstrap/create-platform-identity-user.sql` creates a contained database user.

## Decisions

| Topic | Decision |
| --- | --- |
| Environments | `staging` and `prod`. |
| Budget | $1/month Azure budget with alerts at 50/90/100% actual and 100% forecast. Budgets alert only; hard protection comes from free tiers and caps. |
| Region | centralus, matching the free-offer SQL server. Flex Consumption is available there. |
| Backend runtime | Zip-deployed Azure Functions on Flex Consumption. No container runtime in Azure. |
| Containers | Used for CI and local parity: SQL Server 2022 container plus a one-shot migration container. |
| Registry | None needed. If an image is ever published, use GHCR (Azure Container Registry Basic costs about $5/month). |
| Frontend | Vercel static SPA only. `api/v1/[...path].ts` is deleted. |
| Vercel deploys | Driven by GitHub Actions through the Vercel CLI. Git integration stays off so prod frontend ships only after prod backend passes smoke. |
| SQL databases | `automationtestingdb` is staging, `auomation-db` is prod. Both referenced as `existing` in Bicep. |
| SQL auth | v1 uses SQL auth. Runtime uses the least-privilege contained user `platform_identity_app`; migrations use the admin login. Managed identity with Entra-only auth is a follow-up once `mssql` connection-string MSI support is verified. |
| Recovery timer | Schedule read from app setting `WORKFLOW_DISPATCH_RECOVERY_SCHEDULE`. Local and tests: every minute. Azure: every 6 hours. |
| Rollback | No down migrations. Code rollback by redeploying a previous artifact; data rollback by Azure SQL point-in-time restore (7 days). Documented, not automated. |

## Architecture

```
GitHub (SmayanKulkarni/Enterprise-Agent-Automation-Platform)
 ├─ PR:   ci.yml  verify + SQL container migrate + build ─► Vercel preview (SPA, points at staging API)
 └─ main: ci.yml ─► deploy.yml
          staging: bicep ─► sql:migrate ─► func deploy ─► vercel deploy + alias ─► smoke
          prod:    [required reviewer] ─► bicep ─► sql:migrate ─► func deploy ─► vercel --prod ─► smoke

Vercel (Hobby)
 ├─ preview  ─► func-eaa-staging
 ├─ staging alias eaa-staging.vercel.app ─► func-eaa-staging
 └─ production ─► func-eaa-prod

Azure subscription "Azure subscription 1", centralus
 ├─ rg-eaa-shared    Log Analytics (daily cap 0.1 GB) + Application Insights
 ├─ rg-eaa-staging   Flex plan + Function app (MI), Storage (Durable task hub, deploy package), Key Vault
 ├─ rg-eaa-prod      same shape as staging
 ├─ rg-smayan.kulkarni142-9549 (existing)  SQL server auomaionbackenddb
 │     ├─ automationtestingdb ─► staging
 │     └─ auomation-db        ─► prod
 └─ subscription     Budget $1/month ─► email alerts
```

Telemetry from both environments goes to the shared Application Insights and is distinguished by `DEPLOYMENT_ENVIRONMENT`.

## Components

### Code changes

- `azure-functions/src/functions/workflow-dispatch-recovery.ts`: `schedule: '%WORKFLOW_DISPATCH_RECOVERY_SCHEDULE%'`. Local settings and the CI environment set `0 */1 * * * *`; Bicep sets `0 0 */6 * * *`. A vitest test pins the binding expression.
- Delete `api/v1/[...path].ts` and `tests/platform/showcase-function.test.ts`. Remove `@vercel/functions` if nothing else imports it. `browserResponse` stays; the Azure `browserApi` function uses it.
- `vercel.json`: SPA rewrite becomes `{ "source": "/(.*)", "destination": "/index.html" }`; headers unchanged. Update `tests/platform/showcase-deployment-config.test.ts` accordingly.
- README section 18 and the decision record updated to describe the new deployment.

### Containers: `compose.ci.yml`

- `sql`: `mcr.microsoft.com/mssql/server:2022-latest`, `ACCEPT_EULA=Y`, SA password from environment, healthcheck via `sqlcmd`.
- `sql-init`: Node 22 one-shot container, depends on healthy `sql`. Steps:
  1. Enable `contained database authentication` and create database `platform` with `CONTAINMENT = PARTIAL`.
  2. `pnpm sql:migrate`, then `pnpm sql:migrate` again (must be a no-op), then `pnpm sql:verify`.
  3. `pnpm sql:seed:demo` with `AZURE_SQL_ALLOW_DEMO_SEED=true`.
  4. Run the bootstrap contained-user script with a generated password.
- Runnable locally with `docker compose -f compose.ci.yml up --exit-code-from sql-init`.
- Azurite and a Functions host container are out of scope; Durable Functions has no CI emulator (recorded in the decision doc).

### Infrastructure

- `infra/shared.bicep` (subscription scope, deployed by the bootstrap script and on demand): `rg-eaa-shared`, Log Analytics workspace with `dailyQuotaGb: 0.1`, workspace-based Application Insights, and the $1 budget. Contact email is a parameter.
- `infra/main.bicep` (resource-group scope, replaces the stub) with `infra/staging.bicepparam` and `infra/prod.bicepparam`:
  - Flex Consumption plan and Function app: Node 22, 512 MB instance memory, `maximumInstanceCount: 2`, system-assigned managed identity.
  - Storage account; Function host uses identity-based connection (`AzureWebJobsStorage__accountName`) and a blob container for the deployment package. Role assignments for the Function identity on the account.
  - Key Vault in RBAC mode; `Key Vault Secrets User` for the Function identity.
  - App settings: `WORKFLOW_DISPATCH_RECOVERY_SCHEDULE`, `DEPLOYMENT_ENVIRONMENT`, `CLERK_AUTHORIZED_PARTIES`, `APPLICATIONINSIGHTS_CONNECTION_STRING`, and Key Vault references for `AZURE_SQL_CONNECTION_STRING`, `CLERK_SECRET_KEY`, `WORKFLOW_OPENROUTER_WRAPPING_KEY`, and the other runtime secrets currently read by the backend.
  - `existing` references to the SQL server and database (scope `rg-smayan.kulkarni142-9549`); no modifications.
- `infra/bootstrap.sh` (one-time, run by the owner, idempotent):
  1. Create resource groups and deploy `shared.bicep`.
  2. Create the app registration, service principal, and federated credentials for `repo:SmayanKulkarni/Enterprise-Agent-Automation-Platform:environment:staging` and `:environment:prod`.
  3. Assign `Contributor` on `rg-eaa-staging` and `rg-eaa-prod`, and `User Access Administrator` constrained to role assignments for the Function identities.
  4. Print the values to store as GitHub Environment variables.
  5. Document (not script) seeding Key Vault secrets with `az keyvault secret set` after the first Bicep run creates the vaults. Secret values never pass through Bicep or Actions.

### GitHub

Environments:

- `staging`: no protection.
- `prod`: required reviewer (repo owner).

Per-environment variables: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `FUNCTION_APP_NAME`, `API_ORIGIN`, `WEB_ORIGIN`, `SMOKE_TENANT_ID`.
Per-environment secrets: `AZURE_SQL_MIGRATION_CONNECTION_STRING` (admin, includes `Connect Timeout=120`), `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `SMOKE_CLERK_USER_ID`.
Repository secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

### `.github/workflows/ci.yml`

Triggers: `pull_request`, `push` to `main`. Jobs:

1. `verify`: setup Node from `.node-version`, `corepack enable`, `corepack pnpm install --frozen-lockfile`, `corepack pnpm verify`.
2. `migrations`: `docker compose -f compose.ci.yml up --exit-code-from sql-init`.
3. `infra-lint`: `az bicep build` for every `infra/*.bicep`. No Azure login.
4. `build`: `pnpm build:azure`, then assemble the Functions zip (`dist/`, `host.json`, `package.json`, production dependencies via `pnpm deploy --prod`). Upload as artifact `functions-zip`.
5. `preview` (pull requests only, after `verify`): `vercel pull --environment=preview`, `vercel build`, `vercel deploy --prebuilt`; post the URL as a PR comment.

### `.github/workflows/deploy.yml`

Triggers: `workflow_run` of `ci.yml` completed successfully on `main`, and `workflow_dispatch` with optional `artifact_run_id` for redeploying a prior artifact. `concurrency: deploy-${{ environment }}`, `cancel-in-progress: false`. A reusable job per environment:

1. `azure/login` with OIDC.
2. `az deployment group create` with `infra/main.bicep` and the environment's `.bicepparam`.
3. Add a firewall rule for the runner IP on `auomaionbackenddb`; `pnpm sql:migrate`; remove the rule in an `if: always()` step.
4. Deploy `functions-zip` with `Azure/functions-action` (Flex Consumption).
5. Vercel: `vercel pull`, `vercel build` with the environment's `VITE_PLATFORM_API_ORIGIN`, `vercel deploy --prebuilt` (staging: then `vercel alias set <url> eaa-staging.vercel.app`; prod: `--prod`).
6. `node tools/smoke/smoke.mjs --web $WEB_ORIGIN --api $API_ORIGIN --origin $WEB_ORIGIN`.

`prod` runs only after `staging` succeeds and the reviewer approves.

### Vercel environment

- Production: `VITE_PLATFORM_API_ORIGIN` = prod Function origin, `VITE_CLERK_PUBLISHABLE_KEY`.
- Preview: both set for staging.
- Remove `CLERK_SECRET_KEY`, `CLERK_ISSUER`, `CLERK_AUDIENCE`, `CLERK_AUTHORIZED_PARTIES`, `CLERK_PUBLISHABLE_KEY`, `PLATFORM_LOCAL_TENANTS`, `PLATFORM_LOCAL_CLERK_SUBJECT` after the prod frontend points at Azure.

Clerk authorized parties are an exact list. The staging Function allows only `https://eaa-staging.vercel.app`; random PR preview URLs render the SPA but cannot sign in against staging. Wildcard origins are deliberately not supported.

## Post-deploy testing: `tools/smoke/smoke.mjs`

Plain Node, no new dependencies. Exit code non-zero on any failure, with one line per check.

Tier 1 (no auth, does not wake SQL):

- `GET <web>/` returns 200 HTML containing the app root; `X-Content-Type-Options: nosniff` and `Referrer-Policy` present.
- `GET <web>/governance` returns 200 HTML (SPA rewrite).
- `OPTIONS <api>/api/v1/tenants` with `Origin: <origin>` returns 204 and echoes the origin; with `Origin: https://evil.example` returns 403.
- `GET <api>/api/v1/tenants` without a token returns 401.

Tier 2 (authenticated, wakes SQL):

- Mint a session token for `SMOKE_CLERK_USER_ID` using `tokenFor()` from `tools/e2e/clerk.mjs`.
- `GET <api>/api/v1/tenants` returns 200 and contains `SMOKE_TENANT_ID`.
- Retries with backoff for up to 3 minutes to absorb Flex cold start and SQL free-offer resume.

`tokenFor()` uses the Clerk `dev_browser` flow, which works only on development instances. If prod uses a Clerk production instance, tier 2 switches to a backend-API session token for that environment. The implementation checks this first.

No scheduled smoke runs: a daily authenticated check would spend more than half the monthly free SQL allowance.

## Error handling and failure modes

| Failure | Behavior |
| --- | --- |
| CI verify, migration container, or bicep lint fails | PR blocked; no deploy. |
| Staging Bicep, migration, deploy, or smoke fails | Run stops; prod never requests approval. |
| Migration digest mismatch | Runner throws; deploy stops before code ships. |
| SQL paused at deploy time | `Connect Timeout=120` absorbs resume. |
| Firewall rule cleanup | `if: always()` removes the runner rule even on failure. |
| Prod smoke fails | Job fails, GitHub notifies. Manual rollback per runbook: `vercel rollback`, `workflow_dispatch` with a previous `artifact_run_id`, point-in-time restore if data changed. |
| Spend reaches 50/90/100% of $1 | Email alert. SQL free offer auto-pauses on exhaustion; Flex instances capped at 2. |

Migration rule: every migration must be compatible with the currently deployed code (expand, then contract), because migrations run before the new code ships. Staging is where violations surface.

## Testing of this work

- vitest: recovery timer binding expression; updated `vercel.json` shape test.
- CI itself: the `migrations` job proves all migrations apply and re-apply cleanly on SQL Server 2022.
- `az bicep build` lint in CI.
- First staging deploy is the integration test for Bicep, OIDC, Key Vault references, and smoke. Results recorded as evidence.

## Out of scope

- Container runtime in Azure (Container Apps) and image publishing.
- Playwright browser E2E against staging.
- Automated rollback and a budget-triggered kill switch.
- Managed identity / Entra-only SQL auth.
- `what-if` on pull requests.
- Custom domains.
- The empty `automationdbproj` SQL server and the unused Cognitive Services account (left untouched).

## Manual steps for the owner

1. Run `infra/bootstrap.sh` once while signed in as subscription Owner.
2. Seed Key Vault secrets for each environment after the first Bicep deploy.
3. Create GitHub Environments, variables, and secrets listed above; add yourself as `prod` reviewer.
4. Create a Vercel token and the `eaa-staging` alias ownership (same Vercel team).
5. Create the Clerk smoke user and add its id to both environments; grant it membership in the tenant named by `SMOKE_TENANT_ID`.
6. Run the contained-user bootstrap script against `automationtestingdb` and `auomation-db` if not already done, and store the runtime connection strings in Key Vault.
