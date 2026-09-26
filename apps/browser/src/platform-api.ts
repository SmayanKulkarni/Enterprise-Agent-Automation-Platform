import { clerkAuthorizationHeader } from '../../../packages/browser/src/clerk-authorization-header.js';
import { decodeCommandArguments, decodeProjection, decodeSession, decodeTenants, type BrowserProjection, type BrowserSession, type BrowserTenant } from '../../../packages/browser/src/browser-contracts.js';

type GetToken = () => Promise<string | null>;
const mediaType = 'application/vnd.platform.browser.v1+json';

export type Tenant = BrowserTenant;
export type Session = BrowserSession;
export type Projection = BrowserProjection;

export interface CommandReceipt {
  commandId: string;
  objectId: string;
  revision: number;
  state: string;
  digest: string;
  evidenceIds: readonly string[];
  issues?: readonly { path: string; code: string; message: string }[];
  enrollmentToken?: string;
  webhookSecret?: string;
  webhookTest?: { outcome: 'accepted' | 'invalid-shape' | 'signature' | 'freshness' | 'replay' | 'credential-state' | 'not-found'; runId?: string };
}

export interface PlatformCommand {
  tenantId: string;
  owner: string;
  name: string;
  expectedVersion: number;
  arguments: Record<string, unknown>;
  /** Supply this when restoring a persisted retry. Otherwise one is retained by this client instance. */
  idempotencyKey?: string;
  correlationId?: string;
}

export class PlatformApiError extends Error {
  constructor(readonly status: number, readonly category?: string) {
    super('Platform request failed.');
  }
}

export class PlatformApi {
  private readonly commandKeys = new Map<string, string>();
  constructor(private readonly getToken: GetToken, private readonly apiOrigin = '') {}

  async session(tenantId?: string, signal?: AbortSignal): Promise<Session> {
    try { return decodeSession(await this.get('/api/v1/session', tenantId, signal)); } catch (error) { if (error instanceof PlatformApiError) throw error; throw new PlatformApiError(500); }
  }

  async tenants(signal?: AbortSignal): Promise<readonly Tenant[]> {
    try { return decodeTenants(await this.get('/api/v1/tenants', undefined, signal)); } catch (error) { if (error instanceof PlatformApiError) throw error; throw new PlatformApiError(500); }
  }

  async projection(tenantId: string, collection: string, id?: string, signal?: AbortSignal): Promise<Projection> {
    const detail = id === undefined ? '' : `/${encodeURIComponent(id)}`;
    try { return decodeProjection(await this.get(`/api/v1/tenants/${encodeURIComponent(tenantId)}/${collection}${detail}`, tenantId, signal), tenantId, collection as BrowserProjection['collection']); } catch (error) { if (error instanceof PlatformApiError) throw error; throw new PlatformApiError(500); }
  }

  async command(command: PlatformCommand, signal?: AbortSignal): Promise<CommandReceipt> {
    if (!command.tenantId || !command.owner || !command.name || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0) throw new PlatformApiError(400, 'invalid');
    let argumentsValue: Record<string, unknown>;
    try { argumentsValue = decodeCommandArguments(command.owner, command.name, command.arguments); } catch { throw new PlatformApiError(400, 'invalid'); }
    const retryKey = JSON.stringify([command.tenantId, command.owner, command.name, command.expectedVersion, argumentsValue]);
    const idempotencyKey = command.idempotencyKey ?? this.commandKeys.get(retryKey) ?? crypto.randomUUID();
    this.commandKeys.set(retryKey, idempotencyKey);
    const correlationId = command.correlationId ?? crypto.randomUUID();
    const payload = {
      messageId: correlationId,
      contract: 'browser.v1',
      contractVersion: '1.0.0',
      occurredAt: new Date().toISOString(),
      tenantId: command.tenantId,
      correlationId,
      sender: 'platform-browser',
      classification: 'restricted-operational',
      payload: { expectedVersion: command.expectedVersion, arguments: argumentsValue },
    };
    const headers: Record<string, string> = {
      accept: mediaType,
      'content-type': mediaType,
      'x-platform-tenant': command.tenantId,
      'if-match': String(command.expectedVersion),
      'idempotency-key': idempotencyKey,
      'x-correlation-id': correlationId,
      ...(await clerkAuthorizationHeader(this.getToken)),
    };
    const response = await fetch(`${this.apiOrigin}/api/v1/tenants/${encodeURIComponent(command.tenantId)}/commands/${encodeURIComponent(command.owner)}/${encodeURIComponent(command.name)}`, { method: 'POST', headers, body: JSON.stringify(payload), ...(signal === undefined ? {} : { signal }) });
    const body: unknown = await response.json();
    const responsePayload = record(body)['payload'];
    if (!response.ok) throw new PlatformApiError(response.status, errorCategory(responsePayload));
    return commandReceipt(responsePayload);
  }

  async openRouterConnection(tenantId: string, action: 'connect' | 'rotate' | 'verify' | 'disconnect', expectedVersion: number, key?: string): Promise<CommandReceipt> {
    const response = await fetch(`${this.apiOrigin}/api/v1/tenants/${encodeURIComponent(tenantId)}/openrouter-connection`, { method: 'POST', headers: { accept: mediaType, 'content-type': 'application/json', 'x-platform-tenant': tenantId, 'idempotency-key': crypto.randomUUID(), ...(await clerkAuthorizationHeader(this.getToken)) }, body: JSON.stringify({ action, expectedVersion, ...(key === undefined ? {} : { key }) }) });
    const payload = record((await response.json()))['payload']; if (!response.ok) throw new PlatformApiError(response.status, errorCategory(payload)); return commandReceipt(payload);
  }

  private async get(path: string, tenantId: string | undefined, signal: AbortSignal | undefined): Promise<unknown> {
    const headers: Record<string, string> = { accept: mediaType, ...(await clerkAuthorizationHeader(this.getToken)) };
    if (tenantId !== undefined) headers['x-platform-tenant'] = tenantId;
    const response = await fetch(`${this.apiOrigin}${path}`, { headers, ...(signal === undefined ? {} : { signal }) });
    const body: unknown = await response.json();
    const payload = record(body)['payload'];
    if (!response.ok) throw new PlatformApiError(response.status, errorCategory(payload));
    return payload;
  }
}

function commandReceipt(value: unknown): CommandReceipt {
  const result = record(value);
  if (typeof result['commandId'] !== 'string' || typeof result['objectId'] !== 'string' || !Number.isSafeInteger(result['revision']) || typeof result['state'] !== 'string' || typeof result['digest'] !== 'string' || !Array.isArray(result['evidenceIds']) || !result['evidenceIds'].every((id) => typeof id === 'string')) throw new PlatformApiError(500);
  const issues = result['issues'];
  if (issues !== undefined && (!Array.isArray(issues) || !issues.every((issue: unknown) => issue !== null && typeof issue === 'object' && typeof (issue as Record<string, unknown>)['path'] === 'string' && typeof (issue as Record<string, unknown>)['code'] === 'string'))) throw new PlatformApiError(500);
  const webhookTest = result['webhookTest'];
  if (webhookTest !== undefined && (webhookTest === null || typeof webhookTest !== 'object' || !['accepted', 'invalid-shape', 'signature', 'freshness', 'replay', 'credential-state', 'not-found'].includes(String((webhookTest as Record<string, unknown>)['outcome'])) || (webhookTest as Record<string, unknown>)['runId'] !== undefined && typeof (webhookTest as Record<string, unknown>)['runId'] !== 'string')) throw new PlatformApiError(500);
  const parsedWebhookTest = webhookTest === undefined ? undefined : webhookTest as NonNullable<CommandReceipt['webhookTest']>;
  return { commandId: result['commandId'], objectId: result['objectId'], revision: result['revision'] as number, state: result['state'], digest: result['digest'], evidenceIds: result['evidenceIds'] as string[], ...(issues ? { issues: issues as { path: string; code: string; message: string }[] } : {}), ...(typeof result['enrollmentToken'] === 'string' ? { enrollmentToken: result['enrollmentToken'] } : {}), ...(typeof result['webhookSecret'] === 'string' ? { webhookSecret: result['webhookSecret'] } : {}), ...(parsedWebhookTest === undefined ? {} : { webhookTest: parsedWebhookTest }) };
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new PlatformApiError(500);
  return value as Record<string, unknown>;
}

function errorCategory(payload: unknown): string | undefined {
  const error = payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>)['error'] : undefined;
  return error !== null && typeof error === 'object' && !Array.isArray(error) && typeof (error as Record<string, unknown>)['category'] === 'string' ? (error as Record<string, unknown>)['category'] as string : undefined;
}
