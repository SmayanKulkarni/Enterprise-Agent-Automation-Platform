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
param governancePrometheusUser string
param governanceLokiUser string
param governanceTempoUser string
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
param governanceQueryToken string
@secure()
param demoOpenRouterApiKey string
@secure()
param demoIpPepper string

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
  GOVERNANCE_PROMETHEUS_USER: governancePrometheusUser
  GOVERNANCE_LOKI_USER: governanceLokiUser
  GOVERNANCE_TEMPO_USER: governanceTempoUser
  GOVERNANCE_ASSISTANT_MAX_COST: governanceAssistantMaxCost
}

var plainEnv = map(filter(items(plainSettings), setting => !empty(setting.value)), setting => { name: setting.key, value: setting.value })

var secretEnv = [
  { name: 'AZURE_SQL_CONNECTION_STRING', secretRef: 'azure-sql-connection-string' }
  { name: 'CLERK_SECRET_KEY', secretRef: 'clerk-secret-key' }
  { name: 'WORKFLOW_OPENROUTER_WRAPPING_KEY', secretRef: 'workflow-openrouter-wrapping-key' }
  { name: 'WORKFLOW_MCP_WRAPPING_KEY', secretRef: 'workflow-mcp-wrapping-key' }
  { name: 'OTEL_EXPORTER_OTLP_HEADERS', secretRef: 'otel-exporter-otlp-headers' }
  { name: 'GOVERNANCE_QUERY_TOKEN', secretRef: 'governance-query-token' }
  { name: 'DEMO_OPENROUTER_API_KEY', secretRef: 'demo-openrouter-api-key' }
  { name: 'DEMO_IP_PEPPER', secretRef: 'demo-ip-pepper' }
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
        { name: 'governance-query-token', value: governanceQueryToken }
        { name: 'demo-openrouter-api-key', value: demoOpenRouterApiKey }
        { name: 'demo-ip-pepper', value: demoIpPepper }
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
