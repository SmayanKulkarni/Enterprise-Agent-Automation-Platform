using './main.bicep'

param environmentName = 'prod'
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
