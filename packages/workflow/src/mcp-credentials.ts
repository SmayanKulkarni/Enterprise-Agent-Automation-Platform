import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { report } from '../../errors/src/report.js';
import type { WorkflowStore } from './sql.js';

export interface McpCredentialLookup { resolve(tenantId: string, installationId: string): Promise<string | undefined>; }

export interface McpCredentialEnvelope { version: string; iv: string; tag: string; ciphertext: string; }
export interface McpCredentialRecord { installationId: string; enabled: boolean; key?: McpCredentialEnvelope; digest?: string; connectedAt?: string; }

export const mcpCredentialVariable = (installationId: string): string => `WORKFLOW_MCP_CREDENTIAL_${installationId.replaceAll('-', '').toUpperCase()}`;

export const envMcpCredentials = (environment: Readonly<Record<string, string | undefined>> = process.env): McpCredentialLookup => ({
  resolve: (_tenantId, installationId) => Promise.resolve(environment[mcpCredentialVariable(installationId)] || undefined),
});

const aad = (tenantId: string, installationId: string, version: string): Buffer => Buffer.from(`${tenantId}:mcp:${installationId.toLowerCase()}:${version}`);

export class McpCredentialCrypto {
  constructor(private readonly version: string, private readonly wrappingKey: Buffer) {
    if (wrappingKey.length !== 32) throw new Error('MCP_CREDENTIAL_UNAVAILABLE');
  }
  static fromEnvironment(environment: Readonly<Record<string, string | undefined>>): McpCredentialCrypto | undefined {
    const version = environment['WORKFLOW_MCP_WRAPPING_KEY_VERSION']?.trim();
    const value = environment['WORKFLOW_MCP_WRAPPING_KEY']?.trim();
    return version && value ? new McpCredentialCrypto(version, Buffer.from(value, 'base64url')) : undefined;
  }
  seal(tenantId: string, installationId: string, secret: string): McpCredentialEnvelope {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.wrappingKey, iv); cipher.setAAD(aad(tenantId, installationId, this.version));
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return { version: this.version, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') };
  }
  open(tenantId: string, installationId: string, envelope: McpCredentialEnvelope): string {
    if (envelope.version !== this.version) throw new Error('MCP_CREDENTIAL_UNAVAILABLE');
    const decipher = createDecipheriv('aes-256-gcm', this.wrappingKey, Buffer.from(envelope.iv, 'base64url')); decipher.setAAD(aad(tenantId, installationId, envelope.version)); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  }
  digest(tenantId: string, installationId: string, secret: string): string { return createHmac('sha256', this.wrappingKey).update(`${tenantId}:mcp:${installationId.toLowerCase()}:${secret}`).digest('hex'); }
}

export const storedMcpCredentials = (store: Pick<WorkflowStore, 'workerRead'>, crypto: McpCredentialCrypto, fallback: McpCredentialLookup): McpCredentialLookup => ({
  resolve: async (tenantId, installationId) => {
    const record = await store.workerRead<McpCredentialRecord>(tenantId, 'mcp-credential', installationId.toLowerCase());
    if (!record?.data.enabled || !record.data.key) return fallback.resolve(tenantId, installationId);
    try { return crypto.open(tenantId, installationId, record.data.key); } catch (error) { report(error, { site: 'mcpCredentials.open' }); return undefined; }
  },
});
