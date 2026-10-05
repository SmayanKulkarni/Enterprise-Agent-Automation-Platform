import type { DiscoveredTool } from './discovery-model.js';
import { clerkAuthorizationHeader } from '../../../packages/browser/src/clerk-authorization-header.js';
import { digest } from '../../../packages/contracts/src/index.js';
import { decodeCommandArguments, decodeProjection, decodeSession, decodeTenants, type BrowserProjection, type BrowserSession, type BrowserTenant } from '../../../packages/browser/src/browser-contracts.js';

type GetToken = () => Promise<string | null>;
export const mediaType = 'application/vnd.platform.browser.v1+json';

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
  discovery?: { tools: readonly DiscoveredTool[] };
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
  constructor(readonly status: number, readonly category?: string, readonly code?: string, readonly correlationId?: string) {
    super('Platform request failed.');
  }
}

let latestCorrelationId: string | undefined;
export const lastCorrelationId = (): string | undefined => latestCorrelationId;
export const errorRef = (error: unknown): string | undefined => error instanceof PlatformApiError ? error.correlationId?.slice(0, 8) : undefined;
export const withRef = (message: string, error: unknown): string => { const ref = errorRef(error); return ref === undefined ? message : `${message} Ref: ${ref}`; };

export class PlatformApi {
  private readonly commandKeys = new Map<string, string>();
  constructor(private readonly getToken: GetToken, private readonly apiOrigin = '') {}

  get publicOrigin(): string { return this.apiOrigin || window.location.origin; }

  async session(tenantId?: string, signal?: AbortSignal): Promise<Session> {
    try { return decodeSession(await this.get('/api/v1/session', tenantId, signal)); } catch (error) { if (error instanceof PlatformApiError) throw error; throw new PlatformApiError(500); }
  }

  async tenants(signal?: AbortSignal): Promise<readonly Tenant[]> {
    try { return decodeTenants(await this.get('/api/v1/tenants', undefined, signal)); } catch (error) { if (error instanceof PlatformApiError) throw error; throw new PlatformApiError(500); }
  }

  async projection(tenantId: string, collection: string, id?: string, signal?: AbortSignal, query?: { pageSize?: number; cursor?: string }): Promise<Projection> {
    const detail = id === undefined ? '' : `/${encodeURIComponent(id)}`;
    const search = new URLSearchParams(); if (query?.pageSize !== undefined) search.set('pageSize', String(query.pageSize)); if (query?.cursor !== undefined) search.set('cursor', query.cursor);
    try { return decodeProjection(await this.get(`/api/v1/tenants/${encodeURIComponent(tenantId)}/${collection}${detail}${search.size ? `?${search}` : ''}`, tenantId, signal), tenantId, collection as BrowserProjection['collection']); } catch (error) { if (error instanceof PlatformApiError) throw error; throw new PlatformApiError(500); }
  }

  async command(command: PlatformCommand, signal?: AbortSignal): Promise<CommandReceipt> {
    if (!command.tenantId || !command.owner || !command.name || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0) throw new PlatformApiError(400, 'invalid');
    let argumentsValue: Record<string, unknown>;
    try { argumentsValue = decodeCommandArguments(command.owner, command.name, command.arguments); } catch { throw new PlatformApiError(400, 'invalid'); }
    const retryArguments = typeof argumentsValue['key'] === 'string' ? { ...argumentsValue, key: await digest(argumentsValue['key']) } : argumentsValue;
    const retryKey = JSON.stringify([command.tenantId, command.owner, command.name, command.expectedVersion, retryArguments]);
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
    return commandReceipt(await parseResponse(response, correlationId));
  }

  async openRouterConnection(tenantId: string, action: 'connect' | 'rotate' | 'verify' | 'disconnect', expectedVersion: number, key?: string): Promise<CommandReceipt> {
    const correlationId = crypto.randomUUID();
    const response = await fetch(`${this.apiOrigin}/api/v1/tenants/${encodeURIComponent(tenantId)}/openrouter-connection`, { method: 'POST', headers: { accept: mediaType, 'content-type': 'application/json', 'x-platform-tenant': tenantId, 'idempotency-key': crypto.randomUUID(), 'x-correlation-id': correlationId, ...(await clerkAuthorizationHeader(this.getToken)) }, body: JSON.stringify({ action, expectedVersion, ...(key === undefined ? {} : { key }) }) });
    return commandReceipt(await parseResponse(response, correlationId));
  }

  private async get(path: string, tenantId: string | undefined, signal: AbortSignal | undefined): Promise<unknown> {
    const correlationId = crypto.randomUUID();
    const headers: Record<string, string> = { accept: mediaType, 'x-correlation-id': correlationId, ...(await clerkAuthorizationHeader(this.getToken)) };
    if (tenantId !== undefined) headers['x-platform-tenant'] = tenantId;
    const response = await fetch(`${this.apiOrigin}${path}`, { headers, ...(signal === undefined ? {} : { signal }) });
    return parseResponse(response, correlationId);
  }
}

export async function parseResponse(response: Response, sentCorrelationId: string): Promise<unknown> {
  const correlationId = response.headers.get('x-correlation-id') ?? sentCorrelationId;
  latestCorrelationId = correlationId;
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = errorOf(body);
    throw new PlatformApiError(response.status, error?.category, error?.code, correlationId);
  }
  return record(body)['payload'];
}

export function commandReceipt(value: unknown): CommandReceipt {
  const result = record(value);
  if (typeof result['commandId'] !== 'string' || typeof result['objectId'] !== 'string' || !Number.isSafeInteger(result['revision']) || typeof result['state'] !== 'string' || typeof result['digest'] !== 'string' || !Array.isArray(result['evidenceIds']) || !result['evidenceIds'].every((id) => typeof id === 'string')) throw new PlatformApiError(500);
  const issues = result['issues'];
  if (issues !== undefined && (!Array.isArray(issues) || !issues.every((issue: unknown) => issue !== null && typeof issue === 'object' && typeof (issue as Record<string, unknown>)['path'] === 'string' && typeof (issue as Record<string, unknown>)['code'] === 'string'))) throw new PlatformApiError(500);
  const webhookTest = result['webhookTest'];
  if (webhookTest !== undefined && (webhookTest === null || typeof webhookTest !== 'object' || !['accepted', 'invalid-shape', 'signature', 'freshness', 'replay', 'credential-state', 'not-found'].includes(String((webhookTest as Record<string, unknown>)['outcome'])) || (webhookTest as Record<string, unknown>)['runId'] !== undefined && typeof (webhookTest as Record<string, unknown>)['runId'] !== 'string')) throw new PlatformApiError(500);
  const discovery = result['discovery'];
  if (discovery !== undefined && (discovery === null || typeof discovery !== 'object' || !Array.isArray((discovery as Record<string, unknown>)['tools']) || !((discovery as Record<string, unknown>)['tools'] as unknown[]).every((tool) => tool !== null && typeof tool === 'object' && typeof (tool as Record<string, unknown>)['name'] === 'string' && Array.isArray((tool as Record<string, unknown>)['fields'])))) throw new PlatformApiError(500);
  const parsedWebhookTest = webhookTest === undefined ? undefined : webhookTest as NonNullable<CommandReceipt['webhookTest']>;
  return { commandId: result['commandId'], objectId: result['objectId'], revision: result['revision'] as number, state: result['state'], digest: result['digest'], evidenceIds: result['evidenceIds'] as string[], ...(issues ? { issues: issues as { path: string; code: string; message: string }[] } : {}), ...(typeof result['enrollmentToken'] === 'string' ? { enrollmentToken: result['enrollmentToken'] } : {}), ...(typeof result['webhookSecret'] === 'string' ? { webhookSecret: result['webhookSecret'] } : {}), ...(parsedWebhookTest === undefined ? {} : { webhookTest: parsedWebhookTest }), ...(discovery === undefined ? {} : { discovery: discovery as NonNullable<CommandReceipt['discovery']> }) };
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new PlatformApiError(500);
  return value as Record<string, unknown>;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function errorOf(body: unknown): { category?: string; code?: string } | undefined {
  const envelope = asRecord(body);
  const error = asRecord(asRecord(envelope?.['payload'] ?? envelope)?.['error']);
  if (error === undefined) return undefined;
  const { category, code } = error;
  return { ...(typeof category === 'string' ? { category } : {}), ...(typeof code === 'string' ? { code } : {}) };
}

export type ErrorKind = 'signed-out' | 'denied' | 'not-found' | 'conflict' | 'invalid' | 'rate-limited' | 'unknown' | 'unavailable';

const byCategory: Record<string, ErrorKind> = { denied: 'denied', invalid: 'invalid', conflict: 'conflict', 'unknown-outcome': 'unknown', retryable: 'unavailable', timeout: 'unavailable', terminal: 'unavailable' };

export function describeError(error: unknown, { write = false }: { write?: boolean } = {}): ErrorKind {
  if (error instanceof PlatformApiError) {
    if (error.status === 401) return 'signed-out';
    if (error.status === 404) return 'not-found';
    const known = error.category === undefined ? undefined : byCategory[error.category];
    if (known) return known;
    if (error.status === 401) return 'signed-out';
    if (error.status === 403) return 'denied';
    if (error.status === 404) return 'not-found';
    if (error.status === 409 || error.status === 412) return 'conflict';
    if (error.status === 400 || error.status === 422) return 'invalid';
    if (error.status === 429) return 'rate-limited';
  }
  return write ? 'unknown' : 'unavailable';
}
