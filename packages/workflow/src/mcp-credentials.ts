export interface McpCredentialLookup { resolve(tenantId: string, installationId: string): Promise<string | undefined>; }

export const mcpCredentialVariable = (installationId: string): string => `WORKFLOW_MCP_CREDENTIAL_${installationId.replaceAll('-', '').toUpperCase()}`;

export const envMcpCredentials = (environment: Readonly<Record<string, string | undefined>> = process.env): McpCredentialLookup => ({
  resolve: (_tenantId, installationId) => Promise.resolve(environment[mcpCredentialVariable(installationId)] || undefined),
});
