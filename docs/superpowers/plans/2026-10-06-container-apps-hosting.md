# Container Apps hosting and Grafana Cloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the Functions API as a container on Azure Container Apps (scale to zero), deployed from GHCR images by GitHub Actions, with telemetry, governance reads and dashboards on Grafana Cloud.

**Architecture:** CI builds a Docker image from the compiled `dist/` plus production `node_modules` and pushes it to GHCR tagged with the commit SHA. Each environment deploy migrates SQL, applies Bicep (managed environment plus one `Microsoft.App/containerApps` with `kind: functionapp`), PATCHes Durable queue scale rules, pushes four Grafana dashboards, warms the API, deploys the SPA to Vercel and smoke-tests. A scheduled `wake.yml` starts the scaled-to-zero host so the recovery timer runs.

**Tech Stack:** Bicep (`Microsoft.App` 2026-03-02-preview), Docker, GitHub Actions, jq, Azure Functions v4 Node 22, Durable Functions (Azure Storage provider), Grafana Cloud, vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-container-apps-hosting-design.md` (read it first; it records the probe results behind the resource shape).

## Global Constraints

- Total Azure spend at or under $1 per month; `minReplicas: 0`, `maxReplicas: 2`, 0.5 vCPU / 1 GiB.
- No code comments anywhere (repo rule), including YAML, Bicep, Dockerfile and shell. This overrides `ponytail:` comment guidance.
- `$ponytail`: smallest change that works; no new abstractions or dependencies.
- Code, commit messages and PR text are written normally (not terse). Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Never print Clerk keys, connection strings, tokens or Grafana credentials. Never run `git stash`.
- Do not push, deploy or dispatch workflows without the user saying so. Pushing to `main` triggers CI then deploy.
- zsh traps: write `${VAR}:text`, never `$VAR:text`. Workflow `run` blocks are bash on the runner.
- `docs/` and `tests/` are gitignored but tracked: new files there need `git add -f`.
- Migrations run before the infra step, so new code never starts on an old schema (expand, then contract).
- Image names are lowercase: `ghcr.io/${GITHUB_REPOSITORY,,}-api:<sha>`.

## Review Focus

- GHCR package still private on the first deploy: the revision fails to provision. Expected; documented rerun after flipping it public (Task 7 docs, Task 8 check).
- A Bicep PUT resets `allowScalingRuleOverride`: the PATCH step must run after every infra apply, never before it (Task 5 ordering; Task 8 verifies the rules on the live app).
- Optional `GOVERNANCE_ASSISTANT_MAX_COST` empty: the env entry must be omitted, not set to an empty string (Task 4 what-if check).
- Grafana variables partly set (for example a URL but no token): smoke must skip the Grafana checks rather than fail or false-pass (Task 1 test).
- `wake.yml` with an unset origin variable skips that environment; with a wrong origin it fails the run (Task 6 manual dispatch).

---

### Task 1: Smoke checks for the Grafana query backends

**Files:**
- Modify: `tools/smoke/smoke.mjs`
- Test: `tools/smoke/smoke.test.mjs`

**Interfaces:**
- Produces: `runSmoke(options)` accepts `options.grafana?: { urls: { prometheus: string; loki: string; tempo: string }; user: string; token: string }`; when present it appends three checks named `grafana prometheus accepts the query credentials`, `grafana loki ...`, `grafana tempo ...`. Produces exported `grafanaFromEnv(env)` returning that object or `undefined`.
- Consumes: existing `check`, `expectStatus`, `tierOne`, `tierTwo`.

- [ ] **Step 1: Write the failing tests**

In `tools/smoke/smoke.test.mjs` change the import to `import { grafanaFromEnv, runSmoke, withRetry } from './smoke.mjs';`, extend `beforeAll` to also start a Grafana stand-in, and add the tests.

Replace the `beforeAll` body's last line and add the `grafana` server:

```js
  const grafana = await listen((request, response) => {
    const expected = `Basic ${Buffer.from('stack:token').toString('base64')}`;
    return response.writeHead(request.headers.authorization === expected ? 200 : 401).end('{}');
  });
  servers = { web, api, grafana };
```

Append at the end of the file:

```js
const grafanaOptions = (token) => ({ web: servers.web.url, api: servers.api.url, origin: ORIGIN, grafana: { urls: { prometheus: servers.grafana.url, loki: servers.grafana.url, tempo: servers.grafana.url }, user: 'stack', token } });

test('passes the Grafana checks when the query credentials are accepted', async () => {
  const results = await runSmoke(grafanaOptions('token'));
  expect(results.filter((result) => !result.ok)).toEqual([]);
  expect(results.filter((result) => result.name.startsWith('grafana '))).toHaveLength(3);
});

test('fails each Grafana check when the token is rejected', async () => {
  const results = await runSmoke(grafanaOptions('wrong'));
  expect(results.filter((result) => !result.ok).map((result) => result.name)).toEqual([
    'grafana prometheus accepts the query credentials',
    'grafana loki accepts the query credentials',
    'grafana tempo accepts the query credentials',
  ]);
});

test('reads the Grafana backends from the environment and trims trailing slashes', () => {
  const env = { GOVERNANCE_PROMETHEUS_URL: 'https://p.example/api/prom/', GOVERNANCE_LOKI_URL: 'https://l.example', GOVERNANCE_TEMPO_URL: 'https://t.example/tempo', GOVERNANCE_QUERY_USER: 'stack', GOVERNANCE_QUERY_TOKEN: 'token' };
  expect(grafanaFromEnv(env)).toEqual({ urls: { prometheus: 'https://p.example/api/prom', loki: 'https://l.example', tempo: 'https://t.example/tempo' }, user: 'stack', token: 'token' });
});

test('skips the Grafana checks when any backend setting is missing', () => {
  const env = { GOVERNANCE_PROMETHEUS_URL: 'https://p.example', GOVERNANCE_LOKI_URL: 'https://l.example', GOVERNANCE_QUERY_USER: 'stack', GOVERNANCE_QUERY_TOKEN: 'token' };
  expect(grafanaFromEnv(env)).toBeUndefined();
  expect(grafanaFromEnv({ ...env, GOVERNANCE_TEMPO_URL: 'https://t.example', GOVERNANCE_QUERY_TOKEN: '' })).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run tools/smoke/smoke.test.mjs`
Expected: FAIL (`grafanaFromEnv` is not exported; Grafana checks absent).

- [ ] **Step 3: Implement**

In `tools/smoke/smoke.mjs`:

Move `trim` to module level, directly under `sleep`:

```js
const trim = (url) => url.replace(/\/+$/u, '');
```

Add after `tierTwo`:

```js
const GRAFANA_PROBES = { prometheus: '/api/v1/query?query=1', loki: '/loki/api/v1/labels', tempo: '/api/echo' };

const tierThree = ({ grafana: { urls, user, token } }) => Object.entries(GRAFANA_PROBES).map(([name, path]) => check(`grafana ${name} accepts the query credentials`, async () => {
  const authorization = `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;
  expectStatus(await fetch(`${urls[name]}${path}`, { headers: { authorization } }), 200);
}));

export const grafanaFromEnv = (env) => {
  const urls = { prometheus: env.GOVERNANCE_PROMETHEUS_URL, loki: env.GOVERNANCE_LOKI_URL, tempo: env.GOVERNANCE_TEMPO_URL };
  const user = env.GOVERNANCE_QUERY_USER;
  const token = env.GOVERNANCE_QUERY_TOKEN;
  if (!user || !token || !Object.values(urls).every(Boolean)) return undefined;
  return { urls: Object.fromEntries(Object.entries(urls).map(([name, url]) => [name, trim(url)])), user, token };
};
```

Change the `checks` line in `runSmoke`:

```js
  const checks = [...tierOne(options), ...(options.tenantId && options.userId ? tierTwo(options) : []), ...(options.grafana ? tierThree(options) : [])];
```

In the main block, delete the inner `const trim = ...` line and pass the backends:

```js
  const results = await runSmoke({ web: trim(values.web), api: trim(values.api), origin: trim(values.origin), tenantId: process.env.SMOKE_TENANT_ID, userId: process.env.SMOKE_CLERK_USER_ID, grafana: grafanaFromEnv(process.env) });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run tools/smoke/smoke.test.mjs`
Expected: PASS (existing 4 tests plus 4 new).

- [ ] **Step 5: Commit**

```bash
git add tools/smoke/smoke.mjs tools/smoke/smoke.test.mjs
git commit -m "feat(smoke): check the Grafana query backends accept the governance credentials

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pin the Durable task hub and define the queue scale rules

**Files:**
- Modify: `host.json`
- Create: `infra/scale-rules.jq`
- Test: `tests/platform/scale-rules.test.ts`

**Interfaces:**
- Produces: `infra/scale-rules.jq`, a jq program taking `--arg account <storage account name>` and emitting the Container Apps PATCH body (`properties.template.scale.allowScalingRuleOverride: true` plus six rules: five `azure-queue` rules with `identity: "system"`, one `http` rule). Task 5 invokes it as `jq -n --arg account "$STORAGE_ACCOUNT" -f infra/scale-rules.jq`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Create `tests/platform/scale-rules.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const QUEUES = ['workitems', 'control-00', 'control-01', 'control-02', 'control-03'];

test('scale rules target the Durable task hub pinned in host.json', () => {
  const host = JSON.parse(readFileSync('host.json', 'utf8')) as { extensions: { durableTask: { hubName: string } } };
  const hub = host.extensions.durableTask.hubName.toLowerCase();
  const rules = readFileSync('infra/scale-rules.jq', 'utf8');
  for (const queue of QUEUES) expect(rules).toContain(`"${hub}-${queue}"`);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run tests/platform/scale-rules.test.ts`
Expected: FAIL (`host.extensions` undefined).

- [ ] **Step 3: Implement**

`host.json` becomes:

```json
{
  "version": "2.0",
  "telemetryMode": "OpenTelemetry",
  "extensions": {
    "durableTask": {
      "hubName": "eaahub"
    }
  },
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  }
}
```

Create `infra/scale-rules.jq`:

```jq
def queue($name): { name: $name, custom: { type: "azure-queue", identity: "system", metadata: { accountName: $account, queueName: $name, queueLength: "1" } } };

{
  properties: {
    template: {
      scale: {
        allowScalingRuleOverride: true,
        rules: (["eaahub-workitems", "eaahub-control-00", "eaahub-control-01", "eaahub-control-02", "eaahub-control-03"] | map(queue(.))) + [{ name: "http", http: { metadata: { concurrentRequests: "20" } } }]
      }
    }
  }
}
```

- [ ] **Step 4: Run the test and the jq program**

Run: `corepack pnpm vitest run tests/platform/scale-rules.test.ts`
Expected: PASS.

Run: `jq -n --arg account stexample -f infra/scale-rules.jq | jq '.properties.template.scale.rules | length, .[0].custom.metadata.accountName'`
Expected: `6` then `"stexample"`.

- [ ] **Step 5: Commit**

```bash
git add host.json infra/scale-rules.jq
git add -f tests/platform/scale-rules.test.ts
git commit -m "feat(infra): pin the Durable task hub and define queue scale rules for Container Apps

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Container image and CI image job

**Files:**
- Create: `Dockerfile`, `.dockerignore`
- Modify: `.github/workflows/ci.yml` (the `build` job)

**Interfaces:**
- Produces: image `ghcr.io/<lowercase repo>-api:<commit sha>`, pushed on `push` to `main`. Task 5 deploys exactly this tag.
- Consumes: `corepack pnpm build:azure` output `dist/`, `host.json` (Task 2).

- [ ] **Step 1: Write the image definition**

`Dockerfile`:

```dockerfile
FROM mcr.microsoft.com/azure-functions/node:4-node22

ENV AzureWebJobsScriptRoot=/home/site/wwwroot \
    AzureFunctionsJobHost__Logging__Console__IsEnabled=true

COPY host.json package.json /home/site/wwwroot/
COPY dist /home/site/wwwroot/dist
COPY node_modules /home/site/wwwroot/node_modules
```

`.dockerignore`:

```
*
!dist
!host.json
!package.json
!node_modules
```

- [ ] **Step 2: Check the layout builds**

Docker needs a running daemon; skip this step if Docker is off (CI proves it in Step 4).

Run (scratch context so the real `node_modules` is untouched):

```bash
ctx="$(mktemp -d)" && cp Dockerfile .dockerignore host.json package.json "$ctx" && mkdir "$ctx/dist" "$ctx/node_modules" && docker build -q "$ctx"
```
Expected: prints an image id.

- [ ] **Step 3: Replace the CI `build` job**

In `.github/workflows/ci.yml` replace the whole `build:` job (from `build:` through the `functions-zip` upload step) with:

```yaml
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    env:
      IMAGE_REPOSITORY: ${{ github.repository }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
      - run: corepack enable
      - run: corepack pnpm install --frozen-lockfile
      - run: corepack pnpm build:azure
      - run: |
          set -e
          rm -rf node_modules
          corepack pnpm install --frozen-lockfile --prod --config.node-linker=hoisted
          docker build -t "ghcr.io/${IMAGE_REPOSITORY,,}-api:${GITHUB_SHA}" .
      - if: github.event_name == 'push'
        env:
          REGISTRY_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -e
          echo "$REGISTRY_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
          docker push "ghcr.io/${IMAGE_REPOSITORY,,}-api:${GITHUB_SHA}"
```

- [ ] **Step 4: Verify the workflow parses**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('ok')"`
Expected: `ok`. The real proof is the `build` job on the first pull request (builds without pushing).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore .github/workflows/ci.yml
git commit -m "feat(ci): build and publish the Functions API image to GHCR

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Bicep for the managed environment and the Functions container app

**Files:**
- Modify: `infra/main.bicep` (full replacement)
- Modify: `infra/staging.bicepparam`, `infra/prod.bicepparam`
- Modify: `.github/workflows/ci.yml` (`infra-lint` env)

**Interfaces:**
- Consumes: image tag from env `IMAGE` (Task 3 naming), env vars listed below.
- Produces: Bicep outputs `apiHostname`, `appName`, `storageAccountName`, `sqlServerFqdn`. Task 5 reads the first three with `jq -r .<name>.value`.
- Environment variables read by both `.bicepparam` files: `IMAGE`, `CLERK_ISSUER`, `CLERK_PUBLISHABLE_KEY`, `WEB_ORIGIN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `GOVERNANCE_PROMETHEUS_URL`, `GOVERNANCE_LOKI_URL`, `GOVERNANCE_TEMPO_URL`, `GOVERNANCE_ASSISTANT_MAX_COST` (optional, default empty), and secrets `AZURE_SQL_CONNECTION_STRING`, `CLERK_SECRET_KEY`, `WORKFLOW_OPENROUTER_WRAPPING_KEY`, `WORKFLOW_MCP_WRAPPING_KEY`, `OTEL_EXPORTER_OTLP_HEADERS`, `GOVERNANCE_QUERY_USER`, `GOVERNANCE_QUERY_TOKEN`.

- [ ] **Step 1: Replace `infra/main.bicep`**

```bicep
targetScope = 'resourceGroup'

@allowed(['staging', 'prod'])
param environmentName string
param location string = 'centralus'
param appName string = 'ca-eaa-${environmentName}'
param image string
param recoverySchedule string = '0 0 */6 * * *'
param clerkIssuer string
param clerkPublishableKey string
param clerkAuthorizedParties string
param openRouterWrappingKeyVersion string = 'v1'
param mcpWrappingKeyVersion string = 'v1'
param mcpAllowedHosts string = ''
param otlpEndpoint string
param governancePrometheusUrl string
param governanceLokiUrl string
param governanceTempoUrl string
param governanceAssistantMaxCost string = ''
param sqlServerName string = 'auomaionbackenddb'
param sqlServerResourceGroup string = 'rg-smayan.kulkarni142-9549'
param sharedResourceGroup string = 'rg-eaa-shared'
param sharedAppInsightsName string = 'appi-eaa-shared'

@secure()
param azureSqlConnectionString string
@secure()
param clerkSecretKey string
@secure()
param openRouterWrappingKey string
@secure()
param mcpWrappingKey string
@secure()
param otlpHeaders string
@secure()
param governanceQueryUser string
@secure()
param governanceQueryToken string

var suffix = take(uniqueString(resourceGroup().id), 8)
var storageName = 'steaa${environmentName}${suffix}'

var roles = {
  blobOwner: 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
  queueContributor: '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
  tableContributor: '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
}

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' existing = {
  name: sqlServerName
  scope: resourceGroup(sqlServerResourceGroup)
}

resource insights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: sharedAppInsightsName
  scope: resourceGroup(sharedResourceGroup)
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-eaa-${environmentName}'
  location: location
  properties: {
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
  }
}

var plainSettings = {
  AzureWebJobsStorage__accountName: storage.name
  FUNCTIONS_WORKER_RUNTIME: 'node'
  APPLICATIONINSIGHTS_CONNECTION_STRING: insights.properties.ConnectionString
  DEPLOYMENT_ENVIRONMENT: environmentName
  WORKFLOW_DISPATCH_RECOVERY_SCHEDULE: recoverySchedule
  CLERK_ISSUER: clerkIssuer
  CLERK_PUBLISHABLE_KEY: clerkPublishableKey
  CLERK_AUDIENCE: 'platform-browser-api'
  CLERK_AUTHORIZED_PARTIES: clerkAuthorizedParties
  WORKFLOW_OPENROUTER_WRAPPING_KEY_VERSION: openRouterWrappingKeyVersion
  WORKFLOW_MCP_WRAPPING_KEY_VERSION: mcpWrappingKeyVersion
  WORKFLOW_MCP_ALLOWED_HOSTS: mcpAllowedHosts
  OTEL_EXPORTER_OTLP_ENDPOINT: otlpEndpoint
  GOVERNANCE_PROMETHEUS_URL: governancePrometheusUrl
  GOVERNANCE_LOKI_URL: governanceLokiUrl
  GOVERNANCE_TEMPO_URL: governanceTempoUrl
  GOVERNANCE_ASSISTANT_MAX_COST: governanceAssistantMaxCost
}

var plainEnv = map(filter(items(plainSettings), setting => !empty(setting.value)), setting => { name: setting.key, value: setting.value })

var secretEnv = [
  { name: 'AZURE_SQL_CONNECTION_STRING', secretRef: 'azure-sql-connection-string' }
  { name: 'CLERK_SECRET_KEY', secretRef: 'clerk-secret-key' }
  { name: 'WORKFLOW_OPENROUTER_WRAPPING_KEY', secretRef: 'workflow-openrouter-wrapping-key' }
  { name: 'WORKFLOW_MCP_WRAPPING_KEY', secretRef: 'workflow-mcp-wrapping-key' }
  { name: 'OTEL_EXPORTER_OTLP_HEADERS', secretRef: 'otel-exporter-otlp-headers' }
  { name: 'GOVERNANCE_QUERY_USER', secretRef: 'governance-query-user' }
  { name: 'GOVERNANCE_QUERY_TOKEN', secretRef: 'governance-query-token' }
]

resource app 'Microsoft.App/containerApps@2026-03-02-preview' = {
  name: appName
  location: location
  kind: 'functionapp'
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      ingress: { external: true, targetPort: 80, transport: 'auto' }
      secrets: [
        { name: 'azure-sql-connection-string', value: azureSqlConnectionString }
        { name: 'clerk-secret-key', value: clerkSecretKey }
        { name: 'workflow-openrouter-wrapping-key', value: openRouterWrappingKey }
        { name: 'workflow-mcp-wrapping-key', value: mcpWrappingKey }
        { name: 'otel-exporter-otlp-headers', value: otlpHeaders }
        { name: 'governance-query-user', value: governanceQueryUser }
        { name: 'governance-query-token', value: governanceQueryToken }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: image
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(plainEnv, secretEnv)
        }
      ]
      scale: { minReplicas: 0, maxReplicas: 2 }
    }
  }
}

resource storageRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for role in [roles.blobOwner, roles.queueContributor, roles.tableContributor]: {
  name: guid(storage.id, app.id, role)
  scope: storage
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', role)
  }
}]

output apiHostname string = app.properties.configuration.ingress.fqdn
output appName string = app.name
output storageAccountName string = storage.name
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
```

- [ ] **Step 2: Replace both parameter files**

`infra/staging.bicepparam` (for `prod.bicepparam` use `'prod'`):

```bicep
using './main.bicep'

param environmentName = 'staging'
param image = readEnvironmentVariable('IMAGE')
param recoverySchedule = '0 0 */6 * * *'
param clerkIssuer = readEnvironmentVariable('CLERK_ISSUER')
param clerkPublishableKey = readEnvironmentVariable('CLERK_PUBLISHABLE_KEY')
param clerkAuthorizedParties = readEnvironmentVariable('WEB_ORIGIN')
param otlpEndpoint = readEnvironmentVariable('OTEL_EXPORTER_OTLP_ENDPOINT')
param governancePrometheusUrl = readEnvironmentVariable('GOVERNANCE_PROMETHEUS_URL')
param governanceLokiUrl = readEnvironmentVariable('GOVERNANCE_LOKI_URL')
param governanceTempoUrl = readEnvironmentVariable('GOVERNANCE_TEMPO_URL')
param governanceAssistantMaxCost = readEnvironmentVariable('GOVERNANCE_ASSISTANT_MAX_COST', '')
param azureSqlConnectionString = readEnvironmentVariable('AZURE_SQL_CONNECTION_STRING')
param clerkSecretKey = readEnvironmentVariable('CLERK_SECRET_KEY')
param openRouterWrappingKey = readEnvironmentVariable('WORKFLOW_OPENROUTER_WRAPPING_KEY')
param mcpWrappingKey = readEnvironmentVariable('WORKFLOW_MCP_WRAPPING_KEY')
param otlpHeaders = readEnvironmentVariable('OTEL_EXPORTER_OTLP_HEADERS')
param governanceQueryUser = readEnvironmentVariable('GOVERNANCE_QUERY_USER')
param governanceQueryToken = readEnvironmentVariable('GOVERNANCE_QUERY_TOKEN')
```

- [ ] **Step 3: Extend the `infra-lint` env in `ci.yml`**

Replace its `env:` block with:

```yaml
    env:
      IMAGE: ghcr.io/lint/lint-api:lint
      CLERK_ISSUER: https://lint.invalid
      CLERK_PUBLISHABLE_KEY: pk_test_lint
      WEB_ORIGIN: https://lint.invalid
      OTEL_EXPORTER_OTLP_ENDPOINT: https://lint.invalid/otlp
      GOVERNANCE_PROMETHEUS_URL: https://lint.invalid/api/prom
      GOVERNANCE_LOKI_URL: https://lint.invalid
      GOVERNANCE_TEMPO_URL: https://lint.invalid/tempo
      AZURE_SQL_CONNECTION_STRING: lint
      CLERK_SECRET_KEY: lint
      WORKFLOW_OPENROUTER_WRAPPING_KEY: lint
      WORKFLOW_MCP_WRAPPING_KEY: lint
      OTEL_EXPORTER_OTLP_HEADERS: lint
      GOVERNANCE_QUERY_USER: lint
      GOVERNANCE_QUERY_TOKEN: lint
```

- [ ] **Step 4: Lint the templates**

Run:

```bash
export IMAGE=ghcr.io/lint/lint-api:lint CLERK_ISSUER=https://lint.invalid CLERK_PUBLISHABLE_KEY=pk_test_lint WEB_ORIGIN=https://lint.invalid OTEL_EXPORTER_OTLP_ENDPOINT=https://lint.invalid/otlp GOVERNANCE_PROMETHEUS_URL=https://lint.invalid/api/prom GOVERNANCE_LOKI_URL=https://lint.invalid GOVERNANCE_TEMPO_URL=https://lint.invalid/tempo AZURE_SQL_CONNECTION_STRING=lint CLERK_SECRET_KEY=lint WORKFLOW_OPENROUTER_WRAPPING_KEY=lint WORKFLOW_MCP_WRAPPING_KEY=lint OTEL_EXPORTER_OTLP_HEADERS=lint GOVERNANCE_QUERY_USER=lint GOVERNANCE_QUERY_TOKEN=lint
for file in infra/*.bicep; do az bicep build --file "$file" --stdout > /dev/null; done
for file in infra/*.bicepparam; do az bicep build-params --file "$file" --stdout > /dev/null; done
```
Expected: no errors (warnings allowed).

- [ ] **Step 5: Validate against Azure and check the optional setting is omitted**

Same exported variables as Step 4.

Run: `az deployment group validate -g rg-eaa-staging --parameters infra/staging.bicepparam --query properties.provisioningState -o tsv`
Expected: `Succeeded`.

Run: `az deployment group what-if -g rg-eaa-staging --parameters infra/staging.bicepparam --no-pretty-print --query "changes[?contains(resourceId, 'containerApps')].after.properties.template.containers[0].env[].name" -o tsv | sort`
Expected: lists `AzureWebJobsStorage__accountName`, `CLERK_*`, `OTEL_EXPORTER_OTLP_ENDPOINT`, the three `GOVERNANCE_*_URL` names and the seven secret names; it must not list `GOVERNANCE_ASSISTANT_MAX_COST` or `WORKFLOW_MCP_ALLOWED_HOSTS` (both empty). what-if creates nothing.

- [ ] **Step 6: Commit**

```bash
git add infra/main.bicep infra/staging.bicepparam infra/prod.bicepparam .github/workflows/ci.yml
git commit -m "feat(infra): host the Functions API on Container Apps with Grafana Cloud settings

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Environment deploy workflow

**Files:**
- Modify: `.github/workflows/deploy-environment.yml` (full replacement)
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: Bicep outputs `appName`, `apiHostname`, `storageAccountName` (Task 4); `infra/scale-rules.jq` (Task 2); image `ghcr.io/<repo>-api:<sha>` (Task 3); `tools/smoke/smoke.mjs` reading `GOVERNANCE_*` env (Task 1).
- Produces: `deploy-environment.yml` inputs reduced to `environment` and `sha`; `deploy.yml` resolve job outputs only `sha`.
- New GitHub per-environment variables: `OTEL_EXPORTER_OTLP_ENDPOINT`, `GOVERNANCE_PROMETHEUS_URL`, `GOVERNANCE_LOKI_URL`, `GOVERNANCE_TEMPO_URL`, `GRAFANA_URL`. Secrets: `AZURE_SQL_RUNTIME_CONNECTION_STRING`, `WORKFLOW_OPENROUTER_WRAPPING_KEY`, `WORKFLOW_MCP_WRAPPING_KEY`, `OTEL_EXPORTER_OTLP_HEADERS`, `GOVERNANCE_QUERY_USER`, `GOVERNANCE_QUERY_TOKEN`. Repository secret: `GRAFANA_API_TOKEN`. Removed: `API_ORIGIN`, `FUNCTION_APP_NAME`.

- [ ] **Step 1: Replace `deploy-environment.yml`**

```yaml
name: deploy-environment

on:
  workflow_call:
    inputs:
      environment:
        type: string
        required: true
      sha:
        type: string
        required: true

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    concurrency:
      group: deploy-${{ inputs.environment }}
      cancel-in-progress: false
    env:
      SQL_SERVER: auomaionbackenddb
      SQL_RESOURCE_GROUP: rg-smayan.kulkarni142-9549
      VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
      VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.sha }}
      - uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
      - run: corepack enable
      - run: corepack pnpm install --frozen-lockfile
      - uses: azure/login@v2
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
      - name: Open SQL firewall for this runner
        run: |
          set -e
          ip="$(curl -fsS https://api.ipify.org)"
          echo "RULE=gha-${{ github.run_id }}-${{ inputs.environment }}" >> "$GITHUB_ENV"
          az sql server firewall-rule create --resource-group "$SQL_RESOURCE_GROUP" --server "$SQL_SERVER" \
            --name "gha-${{ github.run_id }}-${{ inputs.environment }}" --start-ip-address "$ip" --end-ip-address "$ip"
      - name: Migrate database
        env:
          AZURE_SQL_CONNECTION_STRING: ${{ secrets.AZURE_SQL_MIGRATION_CONNECTION_STRING }}
        run: |
          for attempt in 1 2 3; do
            if corepack pnpm sql:migrate; then exit 0; fi
            sleep 30
          done
          exit 1
      - name: Close SQL firewall
        if: always()
        run: az sql server firewall-rule delete --resource-group "$SQL_RESOURCE_GROUP" --server "$SQL_SERVER" --name "$RULE" || true
      - name: Deploy infrastructure and roll out the image
        env:
          CLERK_ISSUER: ${{ vars.CLERK_ISSUER }}
          CLERK_PUBLISHABLE_KEY: ${{ secrets.CLERK_PUBLISHABLE_KEY }}
          WEB_ORIGIN: ${{ vars.WEB_ORIGIN }}
          OTEL_EXPORTER_OTLP_ENDPOINT: ${{ vars.OTEL_EXPORTER_OTLP_ENDPOINT }}
          GOVERNANCE_PROMETHEUS_URL: ${{ vars.GOVERNANCE_PROMETHEUS_URL }}
          GOVERNANCE_LOKI_URL: ${{ vars.GOVERNANCE_LOKI_URL }}
          GOVERNANCE_TEMPO_URL: ${{ vars.GOVERNANCE_TEMPO_URL }}
          AZURE_SQL_CONNECTION_STRING: ${{ secrets.AZURE_SQL_RUNTIME_CONNECTION_STRING }}
          CLERK_SECRET_KEY: ${{ secrets.CLERK_SECRET_KEY }}
          WORKFLOW_OPENROUTER_WRAPPING_KEY: ${{ secrets.WORKFLOW_OPENROUTER_WRAPPING_KEY }}
          WORKFLOW_MCP_WRAPPING_KEY: ${{ secrets.WORKFLOW_MCP_WRAPPING_KEY }}
          OTEL_EXPORTER_OTLP_HEADERS: ${{ secrets.OTEL_EXPORTER_OTLP_HEADERS }}
          GOVERNANCE_QUERY_USER: ${{ secrets.GOVERNANCE_QUERY_USER }}
          GOVERNANCE_QUERY_TOKEN: ${{ secrets.GOVERNANCE_QUERY_TOKEN }}
        run: |
          set -e
          export IMAGE="ghcr.io/${GITHUB_REPOSITORY,,}-api:${{ inputs.sha }}"
          outputs="$(az deployment group create \
            --name "eaa-${{ inputs.environment }}-${{ github.run_id }}" \
            --resource-group "${{ vars.AZURE_RESOURCE_GROUP }}" \
            --parameters infra/${{ inputs.environment }}.bicepparam \
            --query properties.outputs -o json)"
          {
            echo "APP_NAME=$(jq -r .appName.value <<<"$outputs")"
            echo "API_HOST=$(jq -r .apiHostname.value <<<"$outputs")"
            echo "STORAGE_ACCOUNT=$(jq -r .storageAccountName.value <<<"$outputs")"
          } >> "$GITHUB_ENV"
      - name: Apply Durable queue scale rules
        run: |
          set -e
          body="$(jq -n --arg account "$STORAGE_ACCOUNT" -f infra/scale-rules.jq)"
          az rest --method PATCH \
            --uri "https://management.azure.com/subscriptions/${{ vars.AZURE_SUBSCRIPTION_ID }}/resourceGroups/${{ vars.AZURE_RESOURCE_GROUP }}/providers/Microsoft.App/containerApps/${APP_NAME}?api-version=2026-03-02-preview" \
            --headers "Content-Type=application/json" \
            --body "$body"
      - name: Push Grafana dashboards
        env:
          GRAFANA_URL: ${{ vars.GRAFANA_URL }}
          GRAFANA_API_TOKEN: ${{ secrets.GRAFANA_API_TOKEN }}
        run: |
          set -e
          for file in infra/observability/dashboards/*.json; do
            jq '{dashboard: (.id = null), overwrite: true}' "$file" \
              | curl -fsS -X POST "${GRAFANA_URL%/}/api/dashboards/db" \
                  -H "Authorization: Bearer $GRAFANA_API_TOKEN" -H "Content-Type: application/json" --data @- > /dev/null
          done
      - name: Warm up the API
        run: curl -s -o /dev/null --retry 10 --retry-delay 10 --retry-all-errors --max-time 60 "https://${API_HOST}/api/v1/tenants" || true
      - run: npm install --global vercel@62
      - name: Deploy frontend
        env:
          VITE_PLATFORM_API_ORIGIN: https://${{ env.API_HOST }}
          WEB_ORIGIN: ${{ vars.WEB_ORIGIN }}
          VERCEL_TARGET: ${{ inputs.environment == 'prod' && 'production' || 'preview' }}
        run: |
          set -e
          vercel pull --yes --environment="$VERCEL_TARGET" --token="$VERCEL_TOKEN"
          if [ "$VERCEL_TARGET" = production ]; then
            vercel build --prod --token="$VERCEL_TOKEN"
            vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN"
          else
            vercel build --token="$VERCEL_TOKEN"
            url="$(vercel deploy --prebuilt --token="$VERCEL_TOKEN")"
            vercel alias set "$url" "${WEB_ORIGIN#https://}" --token="$VERCEL_TOKEN"
          fi
      - name: Smoke test
        env:
          SMOKE_TENANT_ID: ${{ vars.SMOKE_TENANT_ID }}
          SMOKE_CLERK_USER_ID: ${{ secrets.SMOKE_CLERK_USER_ID }}
          CLERK_SECRET_KEY: ${{ secrets.CLERK_SECRET_KEY }}
          CLERK_PUBLISHABLE_KEY: ${{ secrets.CLERK_PUBLISHABLE_KEY }}
          GOVERNANCE_PROMETHEUS_URL: ${{ vars.GOVERNANCE_PROMETHEUS_URL }}
          GOVERNANCE_LOKI_URL: ${{ vars.GOVERNANCE_LOKI_URL }}
          GOVERNANCE_TEMPO_URL: ${{ vars.GOVERNANCE_TEMPO_URL }}
          GOVERNANCE_QUERY_USER: ${{ secrets.GOVERNANCE_QUERY_USER }}
          GOVERNANCE_QUERY_TOKEN: ${{ secrets.GOVERNANCE_QUERY_TOKEN }}
        run: node tools/smoke/smoke.mjs --web "${{ vars.WEB_ORIGIN }}" --api "https://${API_HOST}" --origin "${{ vars.WEB_ORIGIN }}"
```

- [ ] **Step 2: Update `deploy.yml`**

Change the dispatch input description to `ci run id whose image to deploy; defaults to the latest successful ci run on main`. In the `resolve` job, drop the `run_id` output and the line `echo "run_id=$run_id" >> "$GITHUB_OUTPUT"`. In `staging` and `prod`, delete the `run_id: ${{ needs.resolve.outputs.run_id }}` line. Keep the top-level `actions: read` permission; the `resolve` job's `gh run` calls need it.

- [ ] **Step 3: Verify the workflows parse and have no dangling references**

Run:

```bash
python3 -c "import yaml; [yaml.safe_load(open(f)) for f in ('.github/workflows/deploy-environment.yml','.github/workflows/deploy.yml')]; print('ok')"
grep -n "run_id\|functions-zip\|FUNCTION_APP_NAME\|API_ORIGIN" .github/workflows/deploy-environment.yml .github/workflows/deploy.yml
```
Expected: `ok`; the grep matches only `github.run_id` (used for deployment and firewall rule names) and `VITE_PLATFORM_API_ORIGIN`, plus the resolve job's local `run_id` shell variable.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy-environment.yml .github/workflows/deploy.yml
git commit -m "feat(ci): roll out the API image through Bicep and publish Grafana dashboards

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Scheduled wake

**Files:**
- Create: `.github/workflows/wake.yml`

**Interfaces:**
- Consumes: repository variables `STAGING_API_ORIGIN`, `PROD_API_ORIGIN` (owner sets after the first deploy; an unset one is skipped).
- Produces: a run every 6 hours at minute 5 that starts each scaled-to-zero host.

- [ ] **Step 1: Create the workflow**

```yaml
name: wake

on:
  schedule:
    - cron: '5 */6 * * *'
  workflow_dispatch:

permissions: {}

jobs:
  wake:
    runs-on: ubuntu-latest
    env:
      STAGING: ${{ vars.STAGING_API_ORIGIN }}
      PROD: ${{ vars.PROD_API_ORIGIN }}
    steps:
      - run: |
          status=0
          for origin in "$STAGING" "$PROD"; do
            [ -n "$origin" ] || continue
            code="$(curl -s -o /dev/null -w '%{http_code}' --retry 5 --retry-delay 10 --retry-all-errors --max-time 90 "${origin%/}/api/v1/tenants")"
            [ "$code" = 401 ] || { echo "wake ${origin} answered ${code}"; status=1; }
          done
          exit "$status"
```

- [ ] **Step 2: Verify the file parses and the empty-origin path exits cleanly**

Run:

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/wake.yml')); print('ok')"
STAGING= PROD= bash -c 'status=0; for origin in "$STAGING" "$PROD"; do [ -n "$origin" ] || continue; status=1; done; exit "$status"'; echo "unset origins exit $?"
```
Expected: `ok`, then `unset origins exit 0`. The 401 path is verified by the manual dispatch in Task 8.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/wake.yml
git commit -m "feat(ci): wake the scaled-to-zero API every six hours so the recovery timer runs

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-10-06-azure-vercel-deployment-design.md`
- Modify: `docs/diagram-workflow-v1-decisions.md`
- Modify: `README.md` (section 18)
- Modify: `infra/bootstrap.sh` (final `cat <<OUT` block)

**Interfaces:**
- Consumes: the final names from Tasks 1 to 6.
- Produces: nothing code depends on.

- [ ] **Step 1: Mark the old spec superseded**

Insert directly under the title line of `2026-10-06-azure-vercel-deployment-design.md`:

```
> Backend hosting, secrets and the Functions deploy path are superseded by `2026-10-06-container-apps-hosting-design.md` (Flex Consumption is unavailable on this subscription). The rest of this spec stands.
```

- [ ] **Step 2: Update the decisions doc**

In `docs/diagram-workflow-v1-decisions.md`, replace the bullet beginning `- The recovery timer reads` with:

```
- The recovery timer reads `%WORKFLOW_DISPATCH_RECOVERY_SCHEDULE%`. It runs every 6 hours; `wake.yml` starts the scaled-to-zero container at minute 5 of those hours so the host runs the missed slot as past-due.
```

Append to the same section:

```
- Hosting moved from Flex Consumption (blocked on the subscription with `ServerFarmCreationNotAllowed`) to Azure Container Apps: `Microsoft.App/containerApps` with `kind: functionapp`, 0.5 vCPU / 1 GiB, 0 to 2 replicas, image from GHCR tagged with the commit SHA. Spec: `docs/superpowers/specs/2026-10-06-container-apps-hosting-design.md`.
- The platform scaler does not cover the Azure Storage Durable provider, so every deploy PATCHes `allowScalingRuleOverride` with `azure-queue` rules on the pinned hub `eaahub` (`infra/scale-rules.jq`). A Bicep PUT resets the override; the PATCH always follows it. `allowScalingRuleOverride` is rejected on create, which is why it is not in Bicep.
- Key Vault is dropped. A Container Apps `keyVaultUrl` secret must exist when the revision is created, so a first deploy against an empty vault fails. Secrets come from GitHub environment secrets through `@secure()` Bicep parameters and live as Container Apps secrets.
- The migration step now runs before the infra step, because the Bicep apply is the code rollout.
- The managed environment has no Log Analytics destination: the deploy identity is `Reader` on `rg-eaa-shared` and cannot list workspace keys.
- Grafana Cloud: one free stack for both environments (`deployment.environment.name` separates them). Deploys push the four dashboards through the Grafana API; smoke checks that Prometheus, Loki and Tempo accept the query credentials.
```

- [ ] **Step 3: Update README section 18**

Replace the `Azure Functions` table row with:

```
| Azure Container Apps | Browser API, webhook ingress, agent ingress, durable orchestrations | `Microsoft.App/containerApps` (`kind: functionapp`), 0.5 vCPU / 1 GiB, 0 to 2 replicas, scale to zero. Image from `Dockerfile`, published to GHCR by `ci.yml`. Entry: `dist/azure-functions/src/index.js` |
```

Add a row after `Azure SQL`:

```
| Grafana Cloud | Metrics, logs and traces (OTLP); governance reads; four dashboards | One free stack for both environments. `OTEL_EXPORTER_OTLP_*` and `GOVERNANCE_*` come from GitHub environment variables and secrets. `deploy-environment.yml` pushes `infra/observability/dashboards/*.json` |
```

Replace "two Flex instances at most" with "two replicas at most" in the paragraph under the table.

Replace the `ci.yml` and `deploy.yml` bullets in `### Pipeline` with:

```
- `ci.yml` runs on pull requests and on `main`: `pnpm verify`, `compose.ci.yml` (all migrations on SQL Server 2022, applied twice, verified, seeded, contained user created), Bicep lint, the API image (built on every run, pushed to GHCR on `main`), and on pull requests a Vercel preview.
- `deploy.yml` runs after `ci.yml` succeeds on `main`, or by hand with an optional `artifact_run_id` (the CI run whose image to deploy). It calls `deploy-environment.yml` for `staging`, then for `prod` once the `prod` environment reviewer approves. Each environment opens a runner-only SQL firewall rule, migrates, applies Bicep (which rolls out the image), applies the Durable queue scale rules, pushes the Grafana dashboards, warms the API, deploys the SPA with the API origin read from the Bicep outputs, and runs `tools/smoke/smoke.mjs`.
- `wake.yml` runs every 6 hours and requests `/api/v1/tenants` on each environment so the scaled-to-zero host starts and runs the recovery timer.
```

Replace the `### GitHub configuration` paragraph with:

```
Per environment (`staging`, `prod`), variables: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `WEB_ORIGIN`, `CLERK_ISSUER`, `SMOKE_TENANT_ID`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `GOVERNANCE_PROMETHEUS_URL` (ends `/api/prom`), `GOVERNANCE_LOKI_URL`, `GOVERNANCE_TEMPO_URL` (ends `/tempo`), `GRAFANA_URL`. Secrets: `AZURE_SQL_MIGRATION_CONNECTION_STRING` (admin login, `Connect Timeout=120`), `AZURE_SQL_RUNTIME_CONNECTION_STRING` (user `platform_identity_app`), `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `SMOKE_CLERK_USER_ID`, `WORKFLOW_OPENROUTER_WRAPPING_KEY`, `WORKFLOW_MCP_WRAPPING_KEY`, `OTEL_EXPORTER_OTLP_HEADERS` (`Authorization=Basic%20<base64 of instance id:token>`), `GOVERNANCE_QUERY_USER`, `GOVERNANCE_QUERY_TOKEN`. Repository secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `GRAFANA_API_TOKEN`. Repository variables, set after the first deploy: `STAGING_API_ORIGIN`, `PROD_API_ORIGIN` (`https://<apiHostname>` from the Bicep output). `prod` needs a required reviewer. `WEB_ORIGIN` for staging must be `https://eaa-staging.vercel.app`; Clerk authorized parties are an exact list, so PR preview URLs render the SPA but cannot sign in. Never let the staging and prod connection strings swap databases.
```

Replace steps 3 to 5 of `### First-time setup (owner)` with:

```
3. Create the Grafana Cloud stack and three tokens (OTLP write, read-only query, dashboard service account) and set the Grafana variables and secrets above.
4. Set the Vercel Preview and Production variables `VITE_PLATFORM_API_ORIGIN` and `VITE_CLERK_PUBLISHABLE_KEY`; keep Vercel Git integration off.
5. Push to `main`. After `ci.yml` pushes the first image, make the GHCR package public (package settings, change visibility), then rerun the failed deploy. Container Apps cannot pull a private package without credentials.
6. After the first successful deploy, set `STAGING_API_ORIGIN` and `PROD_API_ORIGIN`, and set `VITE_PLATFORM_API_ORIGIN` in Vercel to the same origins.
7. Run `database/bootstrap/create-platform-identity-user.sql` against both databases (after the first migration) and store the runtime connection strings as `AZURE_SQL_RUNTIME_CONNECTION_STRING`.
```

Renumber the Clerk smoke user step to 8. Replace `### Rollback`'s first sentence's "a previous `artifact_run_id`" meaning stays; no edit needed.

- [ ] **Step 4: Update the bootstrap hand-off text**

In `infra/bootstrap.sh`, in the final `cat <<OUT` block remove the `FUNCTION_APP_NAME=func-eaa-<environment>` line and replace everything from `Next: set the remaining variables` to the last `az keyvault secret set` line with:

```
Next: set the remaining variables and secrets listed in README section 18, push to main so
ci.yml publishes the image, make the GHCR package public, then run the deploy workflow.
```

- [ ] **Step 5: Verify and commit**

Run: `bash -n infra/bootstrap.sh && grep -n "keyvault\|FUNCTION_APP_NAME\|Flex" README.md infra/bootstrap.sh`
Expected: no syntax errors; any remaining README `Flex` mention is historical context only (fix if it describes current behaviour).

```bash
git add README.md infra/bootstrap.sh
git add -f docs/superpowers/specs/2026-10-06-azure-vercel-deployment-design.md docs/diagram-workflow-v1-decisions.md
git commit -m "docs: Container Apps hosting, Grafana Cloud setup and the new owner steps

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Verification and first staging deploy (needs the user's go-ahead)

**Files:** none (evidence only).

**Interfaces:** consumes everything above.

- [ ] **Step 1: Full local verification**

Run: `corepack pnpm vitest run` then `corepack pnpm verify`
Expected: all pass (previous baseline 1319 passed, plus the new tests).

- [ ] **Step 2: Ask the user before pushing**

Stop and ask: push `feature/001-workspace` (including the earlier local commit `5267939`), open a PR into `main` so `ci.yml` builds the image and lints Bicep, and set the Grafana and secret configuration. Do not push, merge or dispatch until the user says so. List what the user must set first: the per-environment variables and secrets from README section 18, and the Grafana stack.

- [ ] **Step 3: After the user merges to `main` and the first image is pushed**

Ask the user to make the GHCR package public, then rerun the deploy. Watch with `gh run watch`. If the infra step fails at revision provisioning, check `az containerapp revision list -n ca-eaa-staging -g rg-eaa-staging -o table` and the system log for an image pull error first.

- [ ] **Step 4: Confirm the live scale rules survived the PUT**

Run: `az containerapp show -n ca-eaa-staging -g rg-eaa-staging --query "properties.template.scale" -o json`
Expected: `minReplicas` 0, `maxReplicas` 2, six rules including `eaahub-workitems`.

- [ ] **Step 5: Confirm wake and smoke**

Run `gh workflow run wake.yml` after the owner sets the origin variables; expect a green run. Confirm the smoke step printed `PASS` for the three `grafana ...` checks. Check Grafana for the four dashboards and a trace from `service.namespace=threadline`.

- [ ] **Step 6: Record evidence and clean up**

Save the run URL and results under `evidence/` (gitignored; note them in `docs/diagram-workflow-v1-decisions.md` only if something deviated). Update the memory note `azure-hosting-container-apps-decision.md` with the outcome. Revoke the leaked Vercel token and delete the old `AZUREAPPSERVICE_*` secrets only if the user agrees.
