targetScope = 'resourceGroup'

@allowed(['staging', 'prod'])
param environmentName string
param location string = 'centralus'
param functionAppName string = 'func-eaa-${environmentName}'
param recoverySchedule string = '0 0 */6 * * *'
param clerkIssuer string
param clerkPublishableKey string
param clerkAuthorizedParties string
param openRouterWrappingKeyVersion string = 'v1'
param mcpWrappingKeyVersion string = 'v1'
param mcpAllowedHosts string = ''
param sqlServerName string = 'auomaionbackenddb'
param sqlServerResourceGroup string = 'rg-smayan.kulkarni142-9549'
param sharedResourceGroup string = 'rg-eaa-shared'
param sharedAppInsightsName string = 'appi-eaa-shared'

var suffix = take(uniqueString(resourceGroup().id), 8)
var storageName = 'steaa${environmentName}${suffix}'
var vaultName = 'kv-eaa-${environmentName}-${take(suffix, 6)}'
var packageContainer = 'app-package'

var roles = {
  blobOwner: 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
  queueContributor: '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
  tableContributor: '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
  secretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
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

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource packages 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: packageContainer
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  properties: {
    tenantId: tenant().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'plan-eaa-${environmentName}'
  location: location
  kind: 'functionapp'
  sku: { name: 'FC1', tier: 'FlexConsumption' }
  properties: { reserved: true }
}

func secretRef(vaultName string, secretName string) string => '@Microsoft.KeyVault(VaultName=${vaultName};SecretName=${secretName})'

var appSettings = {
  AzureWebJobsStorage__accountName: storage.name
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
  AZURE_SQL_CONNECTION_STRING: secretRef(vault.name, 'azure-sql-connection-string')
  CLERK_SECRET_KEY: secretRef(vault.name, 'clerk-secret-key')
  WORKFLOW_OPENROUTER_WRAPPING_KEY: secretRef(vault.name, 'workflow-openrouter-wrapping-key')
  WORKFLOW_MCP_WRAPPING_KEY: secretRef(vault.name, 'workflow-mcp-wrapping-key')
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${packageContainer}'
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 2
        instanceMemoryMB: 512
      }
      runtime: { name: 'node', version: '22' }
    }
  }
  dependsOn: [packages]
}

resource settings 'Microsoft.Web/sites/config@2024-04-01' = {
  parent: functionApp
  name: 'appsettings'
  properties: appSettings
  dependsOn: [storageRoles, vaultRole]
}

resource storageRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for role in [roles.blobOwner, roles.queueContributor, roles.tableContributor]: {
  name: guid(storage.id, functionApp.id, role)
  scope: storage
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', role)
  }
}]

resource vaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, functionApp.id, roles.secretsUser)
  scope: vault
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.secretsUser)
  }
}

output functionAppName string = functionApp.name
output functionHostname string = functionApp.properties.defaultHostName
output vaultName string = vault.name
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
