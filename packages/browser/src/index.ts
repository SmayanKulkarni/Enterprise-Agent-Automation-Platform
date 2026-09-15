import { Buffer } from 'node:buffer';
import { canonicalJson, correlationId, decodeContract, descriptorFor, digest, encodeContract, messageId, tenantId, type ContractEnvelope, type NormalizedError } from '../../contracts/src/index.js';
import { IdentityStore, type ExecutionContext, type Proof } from '../../identity/src/index.js';

export interface BrowserRequest { method: 'GET' | 'POST'; path: string; headers: Readonly<Record<string, string | undefined>>; body?: Uint8Array; }
export interface BrowserResponse { status: number; headers: Record<string, string>; body: Uint8Array; }
export interface BrowserCommand { tenantId: string; owner: string; name: string; idempotencyKey: string; correlationId: string; expectedVersion: number; digest: string; envelope: ContractEnvelope; }
export type BrowserCommandHandler = (command: BrowserCommand) => Promise<Record<string, unknown>> | Record<string, unknown>;
export interface ClerkSessionClaims { issuer: string; subject: string; sessionId: string; audience: string; expiresAt: string; tokenUse: string; authorizedParty: string; }
export interface ClerkSessionPort { verifySessionToken(token: string): Promise<ClerkSessionClaims> | ClerkSessionClaims; getSession(sessionId: string): Promise<{ subject: string; status: 'active' | 'ended' | 'revoked' }> | { subject: string; status: 'active' | 'ended' | 'revoked' }; }
export interface ClerkSessionConfig { issuer: string; publishableKey: string; audience: string; authorizedParties: readonly string[]; }
/** Verifies Clerk's token and then its live session; raw tokens never leave this method. */
export class ClerkSessionAdapter {
  constructor(private readonly config: ClerkSessionConfig, private readonly port: ClerkSessionPort) { if (!config.issuer || !config.publishableKey || !config.audience || !config.authorizedParties.length) throw new Error('Clerk configuration is required.'); }
  static fromEnvironment(environment: Readonly<Record<string, string | undefined>>, port: ClerkSessionPort): ClerkSessionAdapter { const origins = environment['CLERK_AUTHORIZED_PARTIES']?.split(',').filter(Boolean) ?? []; return new ClerkSessionAdapter({ issuer: environment['CLERK_ISSUER'] ?? '', publishableKey: environment['CLERK_PUBLISHABLE_KEY'] ?? '', audience: environment['CLERK_AUDIENCE'] ?? '', authorizedParties: origins }, port); }
  async proof(token: string, origin: string | undefined): Promise<Proof> { const claims = await this.port.verifySessionToken(token); if (claims.issuer !== this.config.issuer || claims.audience !== this.config.audience || claims.tokenUse !== 'session' || origin === undefined || !this.config.authorizedParties.includes(origin) || claims.authorizedParty !== origin) throw new Error('DENIED'); const session = await this.port.getSession(claims.sessionId); if (session.status !== 'active' || session.subject !== claims.subject) throw new Error('DENIED'); return { mode: 'interactive', issuer: claims.issuer, subject: claims.subject, audience: claims.audience, expiresAt: claims.expiresAt, tokenUse: claims.tokenUse, sessionId: claims.sessionId, origin }; }
}
export interface BrowserProjection { context: ExecutionContext; collection: string; id?: string; }
export type BrowserProjectionHandler = (projection: BrowserProjection) => Promise<Record<string, unknown>> | Record<string, unknown>;
export interface BrowserTransportOptions { allowedOrigins: readonly string[]; commands?: Readonly<Record<string, BrowserCommandHandler>>; clerk?: ClerkSessionAdapter; identity?: IdentityStore; projections?: BrowserProjectionHandler; now?: () => string; }
export interface SafeCaseProjection { caseId: string; watermark: number; eventSequence: number; generation: number; version: number; classification: 'ordinary' | 'restricted-operational'; redacted: boolean; waiting?: string; approvalDigest?: string; unknownOutcome?: boolean; reconciliation?: string; }
/** Browser-only Case state: a sequence gap refreshes only the affected Case. */
export class CaseWorkbench {
  readonly #watermarks = new Map<string, { watermark: number; eventSequence: number }>();
  async ingest(projection: SafeCaseProjection, refresh: (caseId: string) => Promise<SafeCaseProjection>): Promise<SafeCaseProjection> {
    if (!projection.caseId || !Number.isSafeInteger(projection.watermark) || !Number.isSafeInteger(projection.eventSequence) || projection.generation < 1 || projection.version < 0) throw new Error('INVALID_BROWSER_DTO');
    const current = this.#watermarks.get(projection.caseId); if (current !== undefined && (projection.watermark < current.watermark || projection.eventSequence !== current.eventSequence + 1)) { this.#watermarks.delete(projection.caseId); return this.ingest(await refresh(projection.caseId), refresh); }
    this.#watermarks.set(projection.caseId, { watermark: projection.watermark, eventSequence: projection.eventSequence }); return Object.freeze({ ...projection });
  }
  command(input: { name: 'create' | 'submit' | 'start' | 'cancel' | 'reopen'; expectedVersion: number; arguments: Record<string, unknown>; idempotencyKey: string; schemaKeys: readonly string[] }): { expectedVersion: number; arguments: Record<string, unknown>; idempotencyKey: string } {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || !input.idempotencyKey || Object.keys(input.arguments).some((key) => !input.schemaKeys.includes(key))) throw new Error('INVALID_BROWSER_COMMAND'); return { expectedVersion: input.expectedVersion, arguments: JSON.parse(canonicalJson(input.arguments)) as Record<string, unknown>, idempotencyKey: input.idempotencyKey };
  }
}

const MEDIA_TYPE = 'application/vnd.platform.browser.v1+json';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const collections = new Set(['cases', 'interventions', 'capabilities', 'installations', 'memory', 'evaluations', 'improvements', 'packages', 'operations', 'deployments']);
export const BROWSER_V1_ROUTE_INVENTORY = Object.freeze([
  { method: 'GET', path: '/api/v1/session', owner: 'identity', action: 'identity.session.read', ready: true },
  { method: 'GET', path: '/api/v1/tenants', owner: 'identity', action: 'identity.membership.list', ready: true },
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
      if (path === '/api/v1/session') return await this.session(request);
      if (path === '/api/v1/tenants') return await this.tenants(request);
      const match = /^\/api\/v1\/tenants\/([^/]+)(?:\/(.*))?$/u.exec(path); if (match === null) return await this.error(request, 404, { category: 'invalid', code: 'NOT_FOUND', message: 'Route was not found.', redacted: true });
      const routeTenant = tenantId(decodeURIComponent(match[1] ?? ''));
      const tail = match[2] ?? ''; this.validateQuery(url, routeTenant);
      if (request.method === 'GET' && tail === 'events') return await this.featureNotReady(request, routeTenant);
      if (request.method === 'GET' && this.collectionRoute(tail)) return await this.projection(request, String(routeTenant), tail);
      const commandRoute = /^commands\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)$/u.exec(tail);
      if (request.method !== 'POST' || commandRoute === null) return await this.error(request, 404, { category: 'invalid', code: 'NOT_FOUND', message: 'Route was not found.', redacted: true });
      return await this.command(request, String(routeTenant), commandRoute[1] ?? '', commandRoute[2] ?? '');
    } catch (error) { return await this.error(request, 400, failure(error)); }
  }

  private collectionRoute(tail: string): boolean { const [collection, id, extra] = tail.split('/'); return collection !== undefined && collections.has(collection) && extra === undefined && (id === undefined || UUID.test(id)); }
  private async context(request: BrowserRequest, selectedTenant: string): Promise<ExecutionContext | undefined> { if (this.options.clerk === undefined || this.options.identity === undefined) return undefined; const authorization = header(request, 'authorization'); if (!authorization?.startsWith('Bearer ') || authorization.length < 8) throw new Error('DENIED'); return this.options.identity.authenticate(await this.options.clerk.proof(authorization.slice(7), header(request, 'origin')), selectedTenant, 'platform-browser-api', this.#now()); }
  private async session(request: BrowserRequest): Promise<BrowserResponse> { if (this.options.clerk === undefined || this.options.identity === undefined) return this.featureNotReady(request, undefined); const authorization = header(request, 'authorization'); if (!authorization?.startsWith('Bearer ')) throw new Error('DENIED'); const proof = await this.options.clerk.proof(authorization.slice(7), header(request, 'origin')); const user = this.options.identity.authenticate(proof, header(request, 'x-platform-tenant') ?? this.firstTenant(proof), 'platform-browser-api', this.#now()); return this.success(request, String(user.tenantId), { user: { id: user.userId }, tenant: { id: user.tenantId, epoch: user.tenantEpoch }, actionHints: [] }); }
  private async tenants(request: BrowserRequest): Promise<BrowserResponse> { if (this.options.clerk === undefined || this.options.identity === undefined) return this.featureNotReady(request, undefined); const authorization = header(request, 'authorization'); if (!authorization?.startsWith('Bearer ')) throw new Error('DENIED'); const proof = await this.options.clerk.proof(authorization.slice(7), header(request, 'origin')); const selected = this.firstTenant(proof); const context = this.options.identity.authenticate(proof, selected, 'platform-browser-api', this.#now()); return this.success(request, String(context.tenantId), { tenants: this.options.identity.membershipsForUser(context.userId).map((membership) => ({ id: membership.tenantId, profiles: membership.profiles, epoch: membership.epoch })) }); }
  private firstTenant(proof: Proof): string { if (this.options.identity === undefined) throw new Error('DENIED'); const membership = this.options.identity.membershipsForUser(this.options.identity.userForExternal(proof.issuer, proof.subject).id)[0]; if (membership === undefined) throw new Error('DENIED'); return String(membership.tenantId); }
  private async projection(request: BrowserRequest, routeTenant: string, tail: string): Promise<BrowserResponse> { const [collection, id] = tail.split('/'); const context = await this.context(request, routeTenant); if (context === undefined || collection === undefined || this.options.projections === undefined) return this.featureNotReady(request, routeTenant); return this.success(request, routeTenant, await this.options.projections({ context, collection, ...(id === undefined ? {} : { id }) })); }
  private validateQuery(url: URL, routeTenant: string): void {
    const pageSize = url.searchParams.get('pageSize'); if (pageSize !== null && (!/^[1-9][0-9]*$/u.test(pageSize) || Number(pageSize) > 100)) throw new Error('INVALID_PAGE_SIZE');
    const cursor = url.searchParams.get('cursor'); if (cursor !== null) { if (!/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new Error('INVALID_CURSOR'); const decoded = Buffer.from(cursor, 'base64url').toString('utf8'); if (!decoded.startsWith(`${routeTenant}.`)) throw new Error('TENANT_MISMATCH'); }
  }
  private assertOrigin(request: BrowserRequest): void { const origin = header(request, 'origin'); if (origin === undefined || !this.options.allowedOrigins.includes(origin)) throw new Error('DENIED'); }
  private async command(request: BrowserRequest, routeTenant: string, owner: string, name: string): Promise<BrowserResponse> {
    const authorization = header(request, 'authorization'); const key = header(request, 'idempotency-key'); const correlation = header(request, 'x-correlation-id'); const contentType = header(request, 'content-type');
    if (!authorization?.startsWith('Bearer ') || authorization.length < 8 || key === undefined || !UUID.test(correlation ?? '') || contentType !== MEDIA_TYPE || request.body === undefined) throw new Error('DENIED');
    await this.context(request, routeTenant); const envelope = decodeContract(descriptorFor('browser.v1'), request.body, routeTenant);
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
    envelope.tenantId = tenantId(selectedTenant ?? '11111111-1111-4111-8111-111111111111'); if (correlation !== undefined && UUID.test(correlation)) envelope.correlationId = correlationId(correlation);
    const encoded = await encodeContract(descriptorFor('browser.v1'), envelope);
    return { status, headers: { 'content-type': MEDIA_TYPE, 'x-contract-version': '1.0.0', 'x-correlation-id': id }, body: encoded.bytes };
  }
}
