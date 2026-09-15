import { Buffer } from 'node:buffer';
import { canonicalJson, correlationId, decodeContract, descriptorFor, digest, encodeContract, messageId, tenantId, type ContractEnvelope, type NormalizedError } from '../../contracts/src/index.js';

export interface BrowserRequest { method: 'GET' | 'POST'; path: string; headers: Readonly<Record<string, string | undefined>>; body?: Uint8Array; }
export interface BrowserResponse { status: number; headers: Record<string, string>; body: Uint8Array; }
export interface BrowserCommand { tenantId: string; owner: string; name: string; idempotencyKey: string; correlationId: string; expectedVersion: number; digest: string; envelope: ContractEnvelope; }
export type BrowserCommandHandler = (command: BrowserCommand) => Promise<Record<string, unknown>> | Record<string, unknown>;
export interface BrowserTransportOptions { allowedOrigins: readonly string[]; commands?: Readonly<Record<string, BrowserCommandHandler>>; now?: () => string; }

const MEDIA_TYPE = 'application/vnd.platform.browser.v1+json';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const collections = new Set(['cases', 'interventions', 'capabilities', 'installations', 'memory', 'evaluations', 'improvements', 'packages', 'operations', 'deployments']);
export const BROWSER_V1_ROUTE_INVENTORY = Object.freeze([
  { method: 'GET', path: '/api/v1/session', owner: 'identity', action: 'identity.session.read', ready: false },
  { method: 'GET', path: '/api/v1/tenants', owner: 'identity', action: 'identity.membership.list', ready: false },
  { method: 'GET', path: '/api/v1/tenants/:tenantId/{cases,interventions,capabilities,installations,memory,evaluations,improvements,packages,operations,deployments}[/:id]', owner: 'projection', action: 'projection.read', ready: false },
  { method: 'POST', path: '/api/v1/tenants/:tenantId/commands/:owner/:name', owner: 'named registry', action: 'owner.command', ready: false },
  { method: 'GET', path: '/api/v1/tenants/:tenantId/events', owner: 'operations', action: 'operations.events.read', ready: false },
]);

function header(request: BrowserRequest, name: string): string | undefined { return request.headers[name] ?? request.headers[name.toLowerCase()]; }
function failure(error: unknown): NormalizedError {
  const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'INVALID_REQUEST';
  if (['DENIED', 'TENANT_MISMATCH', 'INVALID_IDENTIFIER'].includes(code)) return { category: 'denied', code: 'DENIED', message: 'Request was not accepted.', redacted: true };
  if (['CONFLICT', 'STALE'].includes(code)) return { category: 'conflict', code, message: 'Request conflicts with current state.', redacted: true };
  return { category: 'invalid', code: 'INVALID_REQUEST', message: 'Request was not accepted.', redacted: true };
}

export class BrowserV1Transport {
  readonly #commands: Readonly<Record<string, BrowserCommandHandler>>; readonly #now: () => string;
  constructor(private readonly options: BrowserTransportOptions) { this.#commands = options.commands ?? {}; this.#now = options.now ?? (() => new Date().toISOString()); }

  async handle(request: BrowserRequest): Promise<BrowserResponse> {
    try {
      const url = new URL(request.path, 'https://platform.invalid'); const path = url.pathname;
      if (request.method === 'POST' || path.endsWith('/events')) this.assertOrigin(request);
      if (path === '/api/v1/session' || path === '/api/v1/tenants') return await this.featureNotReady(request, undefined);
      const match = /^\/api\/v1\/tenants\/([^/]+)(?:\/(.*))?$/u.exec(path); if (match === null) return await this.error(request, 404, { category: 'invalid', code: 'NOT_FOUND', message: 'Route was not found.', redacted: true });
      const routeTenant = tenantId(decodeURIComponent(match[1] ?? ''));
      const tail = match[2] ?? ''; this.validateQuery(url, routeTenant);
      if (request.method === 'GET' && tail === 'events') return await this.featureNotReady(request, routeTenant);
      if (request.method === 'GET' && this.collectionRoute(tail)) return await this.featureNotReady(request, routeTenant);
      const commandRoute = /^commands\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)$/u.exec(tail);
      if (request.method !== 'POST' || commandRoute === null) return await this.error(request, 404, { category: 'invalid', code: 'NOT_FOUND', message: 'Route was not found.', redacted: true });
      return await this.command(request, String(routeTenant), commandRoute[1] ?? '', commandRoute[2] ?? '');
    } catch (error) { return await this.error(request, 400, failure(error)); }
  }

  private collectionRoute(tail: string): boolean { const [collection, id, extra] = tail.split('/'); return collection !== undefined && collections.has(collection) && extra === undefined && (id === undefined || UUID.test(id)); }
  private validateQuery(url: URL, routeTenant: string): void {
    const pageSize = url.searchParams.get('pageSize'); if (pageSize !== null && (!/^[1-9][0-9]*$/u.test(pageSize) || Number(pageSize) > 100)) throw new Error('INVALID_PAGE_SIZE');
    const cursor = url.searchParams.get('cursor'); if (cursor !== null) { if (!/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new Error('INVALID_CURSOR'); const decoded = Buffer.from(cursor, 'base64url').toString('utf8'); if (!decoded.startsWith(`${routeTenant}.`)) throw new Error('TENANT_MISMATCH'); }
  }
  private assertOrigin(request: BrowserRequest): void { const origin = header(request, 'origin'); if (origin === undefined || !this.options.allowedOrigins.includes(origin)) throw new Error('DENIED'); }
  private async command(request: BrowserRequest, routeTenant: string, owner: string, name: string): Promise<BrowserResponse> {
    const authorization = header(request, 'authorization'); const key = header(request, 'idempotency-key'); const correlation = header(request, 'x-correlation-id'); const contentType = header(request, 'content-type');
    if (!authorization?.startsWith('Bearer ') || authorization.length < 8 || key === undefined || !UUID.test(correlation ?? '') || contentType !== MEDIA_TYPE || request.body === undefined) throw new Error('DENIED');
    const envelope = decodeContract(descriptorFor('browser.v1'), request.body, routeTenant);
    const payload = envelope.payload; const expectedVersion = payload['expectedVersion']; const argumentsValue = payload['arguments']; const ifMatch = header(request, 'if-match');
    if (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion) || expectedVersion < 0 || ifMatch !== String(expectedVersion)) throw new Error('STALE'); const version = expectedVersion;
    const command: BrowserCommand = { tenantId: routeTenant, owner, name, idempotencyKey: key, correlationId: correlationId(correlation), expectedVersion: version, digest: await digest(argumentsValue), envelope };
    const handler = this.#commands[`${owner}.${name}`]; if (handler === undefined) return this.featureNotReady(request, routeTenant);
    return this.success(request, routeTenant, await handler(command));
  }
  private async featureNotReady(request: BrowserRequest, selectedTenant: string | undefined): Promise<BrowserResponse> { return this.error(request, 501, { category: 'terminal', code: 'FEATURE_NOT_READY', message: 'This feature is not ready.', redacted: true }, selectedTenant); }
  private async success(request: BrowserRequest, selectedTenant: string | undefined, payload: Record<string, unknown>): Promise<BrowserResponse> { return this.response(request, 200, selectedTenant, payload); }
  private async error(request: BrowserRequest, status: number, error: NormalizedError, selectedTenant?: string): Promise<BrowserResponse> { return this.response(request, status, selectedTenant, { error }); }
  private async response(request: BrowserRequest, status: number, selectedTenant: string | undefined, payload: Record<string, unknown>): Promise<BrowserResponse> {
    const correlation = header(request, 'x-correlation-id'); const id = UUID.test(correlation ?? '') ? correlation ?? '' : '11111111-1111-4111-8111-111111111111';
    const envelope: ContractEnvelope = { messageId: messageId(id), contract: 'browser.v1', contractVersion: '1.0.0', occurredAt: this.#now(), sender: 'browser-transport', classification: 'restricted-operational', payload: { ...JSON.parse(canonicalJson(payload)) as Record<string, unknown>, completeness: 'not-ready' } };
    if (selectedTenant !== undefined) envelope.tenantId = tenantId(selectedTenant); if (correlation !== undefined && UUID.test(correlation)) envelope.correlationId = correlationId(correlation);
    const encoded = await encodeContract(descriptorFor('browser.v1'), envelope);
    return { status, headers: { 'content-type': MEDIA_TYPE, 'x-contract-version': '1.0.0', 'x-correlation-id': id }, body: encoded.bytes };
  }
}
