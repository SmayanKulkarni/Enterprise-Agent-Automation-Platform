import { Buffer } from 'node:buffer';
import { createClerkClient, verifyToken } from '@clerk/backend';
import { canonicalJson, correlationId, decodeContract, descriptorFor, digest, encodeContract, messageId, tenantId, type ContractEnvelope, type CorrelationId, type NormalizedError } from '../../contracts/src/index.js';
import { AppError } from '../../errors/src/app-error.js';
import { correlationIdFrom } from '../../errors/src/boundary.js';
import { classify } from '../../errors/src/classify.js';
import type { ErrorContext } from '../../errors/src/report.js';
import { type IdentityReadStore, type ExecutionContext, type GroupContext, type Proof } from '../../identity/src/index.js';
import { BROWSER_COLLECTIONS, decodeCommandArguments, GROUP_COLLECTIONS, GROUP_QUERY_KEYS, hasCommandArgumentSchema } from './browser-contracts.js';

export interface BrowserRequest { method: 'GET' | 'POST'; path: string; headers: Readonly<Record<string, string | undefined>>; body?: Uint8Array; }
export interface BrowserResponse { status: number; headers: Record<string, string>; body: Uint8Array; }
export interface BrowserCommand { context: ExecutionContext; tenantId: string; owner: string; name: string; idempotencyKey: string; correlationId: string; expectedVersion: number; digest: string; arguments: Record<string, unknown>; envelope: ContractEnvelope; }
export interface GroupCommand { userId: string; group?: GroupContext; name: string; idempotencyKey: string; correlationId: CorrelationId; expectedVersion: number; digest: string; arguments: Record<string, unknown>; }
export type GroupCommandHandler = (command: GroupCommand) => Promise<Record<string, unknown>>;
export interface GroupProjection { context: GroupContext; collection: string; query: Readonly<Record<string, string>>; }
export type GroupProjectionHandler = (projection: GroupProjection) => Promise<Record<string, unknown>>;
export type BrowserCommandHandler = (command: BrowserCommand) => Promise<Record<string, unknown>> | Record<string, unknown>;
export interface ClerkSessionClaims { issuer: string; subject: string; sessionId: string; audience: string; expiresAt: string; tokenUse: string; authorizedParty: string; }
export interface ClerkSessionPort { verifySessionToken(token: string): Promise<ClerkSessionClaims> | ClerkSessionClaims; getSession(sessionId: string): Promise<{ subject: string; status: 'active' | 'ended' | 'revoked' }> | { subject: string; status: 'active' | 'ended' | 'revoked' }; }
export interface ClerkSessionConfig { issuer: string; publishableKey: string; audience: string; authorizedParties: readonly string[]; }
export interface ClerkBackend { verifyToken(token: string, options: { audience: string; authorizedParties: string[]; secretKey: string }): Promise<Record<string, unknown> | undefined>; sessions: { getSession(sessionId: string): Promise<{ userId: string; status: string }>; }; }
const clerkBackend = (secretKey: string): ClerkBackend => ({ verifyToken, sessions: createClerkClient({ secretKey }).sessions });
const required = (environment: Readonly<Record<string, string | undefined>>, name: string): string => { const value = environment[name]?.trim(); if (!value) throw new AppError('UNAVAILABLE', { cause: new Error(`Missing ${name}.`) }); return value; };
const isTokenFailure = (error: unknown): boolean => error instanceof Error && 'reason' in error && typeof error.reason === 'string' && error.reason.startsWith('token-');
const isMissingSession = (error: unknown): boolean => typeof error === 'object' && error !== null && 'status' in error && error.status === 404;
const claim = (value: Record<string, unknown>, name: string): string => typeof value[name] === 'string' && value[name] ? value[name] : (() => { throw new AppError('UNAUTHENTICATED'); })();
const expiresAt = (value: Record<string, unknown>): string => typeof value['exp'] === 'number' && Number.isSafeInteger(value['exp']) ? new Date(value['exp'] * 1000).toISOString() : (() => { throw new AppError('UNAUTHENTICATED'); })();

/** Official Clerk Backend SDK port. Instantiate only in the server process. */
export function liveClerkSessionAdapter(environment: Readonly<Record<string, string | undefined>>, backend?: ClerkBackend): ClerkSessionAdapter {
  const issuer = required(environment, 'CLERK_ISSUER'); const publishableKey = required(environment, 'CLERK_PUBLISHABLE_KEY'); const secretKey = required(environment, 'CLERK_SECRET_KEY'); const audience = required(environment, 'CLERK_AUDIENCE'); const authorizedParties = required(environment, 'CLERK_AUTHORIZED_PARTIES').split(',').map((origin) => origin.trim()).filter(Boolean);
  if (audience !== 'platform-browser-api' || !authorizedParties.length) throw new Error('Invalid Clerk browser configuration.');
  const client = backend ?? clerkBackend(secretKey); return new ClerkSessionAdapter({ issuer, publishableKey, audience, authorizedParties }, {
    async verifySessionToken(token) { let verified: Record<string, unknown> | undefined; try { verified = await client.verifyToken(token, { secretKey, audience, authorizedParties }); } catch (error) { throw isTokenFailure(error) ? new AppError('UNAUTHENTICATED', { cause: error }) : error; } if (verified === undefined) throw new AppError('UNAUTHENTICATED'); return { issuer: claim(verified, 'iss'), subject: claim(verified, 'sub'), sessionId: claim(verified, 'sid'), audience, expiresAt: expiresAt(verified), tokenUse: 'session', authorizedParty: claim(verified, 'azp') }; },
    async getSession(sessionId) { let session: { userId: string; status: string }; try { session = await client.sessions.getSession(sessionId); } catch (error) { throw isMissingSession(error) ? new AppError('UNAUTHENTICATED', { cause: error }) : error; } return { subject: session.userId, status: session.status === 'active' ? 'active' : 'revoked' }; },
  });
}

/** Browser callers pass only Clerk's short-lived session token to the transport. */
export async function clerkAuthorizationHeader(getToken: () => Promise<string | null>): Promise<Record<'authorization', string>> { const token = await getToken(); if (!token) throw new Error('DENIED'); return { authorization: `Bearer ${token}` }; }
/** Verifies Clerk's token and then its live session; raw tokens never leave this method. */
export class ClerkSessionAdapter {
  constructor(private readonly config: ClerkSessionConfig, private readonly port: ClerkSessionPort) { if (!config.issuer || !config.publishableKey || !config.audience || !config.authorizedParties.length) throw new Error('Clerk configuration is required.'); }
  static fromEnvironment(environment: Readonly<Record<string, string | undefined>>, port: ClerkSessionPort): ClerkSessionAdapter { const origins = environment['CLERK_AUTHORIZED_PARTIES']?.split(',').filter(Boolean) ?? []; return new ClerkSessionAdapter({ issuer: environment['CLERK_ISSUER'] ?? '', publishableKey: environment['CLERK_PUBLISHABLE_KEY'] ?? '', audience: environment['CLERK_AUDIENCE'] ?? '', authorizedParties: origins }, port); }
  async proof(token: string, origin: string | undefined): Promise<Proof> { const claims = await this.port.verifySessionToken(token); if (claims.issuer !== this.config.issuer || claims.audience !== this.config.audience || claims.tokenUse !== 'session' || origin === undefined || !this.config.authorizedParties.includes(origin) || claims.authorizedParty !== origin) throw new Error('DENIED'); const session = await this.port.getSession(claims.sessionId); if (session.status !== 'active' || session.subject !== claims.subject) throw new Error('DENIED'); return { mode: 'interactive', issuer: claims.issuer, subject: claims.subject, audience: claims.audience, expiresAt: claims.expiresAt, tokenUse: claims.tokenUse, sessionId: claims.sessionId, origin }; }
}
export interface BrowserProjection { context: ExecutionContext; collection: string; id?: string; pageSize?: number; cursor?: string; }
export type BrowserProjectionHandler = (projection: BrowserProjection) => Promise<Record<string, unknown>> | Record<string, unknown>;
export type BrowserConnectionHandler = (input: { context: ExecutionContext; action: 'connect' | 'rotate' | 'verify' | 'disconnect'; expectedVersion: number; idempotencyKey: string; key?: string }) => Promise<Record<string, unknown>>;
export interface BrowserTransportOptions { allowedOrigins: readonly string[]; commands?: Readonly<Record<string, BrowserCommandHandler>>; groupCommands?: Readonly<Record<string, GroupCommandHandler>>; groupProjections?: GroupProjectionHandler; connections?: BrowserConnectionHandler; clerk?: ClerkSessionAdapter; identity?: IdentityReadStore; projections?: BrowserProjectionHandler; now?: () => string; onError?: (error: unknown, context: ErrorContext) => void; }
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

export interface SafeCapabilityMemoryProjection { tenantId: string; collection: 'capabilities' | 'installations' | 'memory'; completeness: 'full' | 'partial'; version?: string; records: readonly Record<string, unknown>[]; }
const forbiddenBrowserKeys = /(?:token|secret|password|credential(?:bytes|value|payload)|payload)/iu;
const safeBrowserValue = (value: unknown): boolean => value === null || typeof value !== 'object' || Array.isArray(value) ? !Array.isArray(value) || value.every(safeBrowserValue) : Object.entries(value as Record<string, unknown>).every(([key, child]) => !forbiddenBrowserKeys.test(key) && safeBrowserValue(child));

/** Client-only safe projection state; availability never becomes an invocation grant. */
export class CapabilityMemoryWorkbench {
  ingest(input: SafeCapabilityMemoryProjection): SafeCapabilityMemoryProjection {
    tenantId(input.tenantId); if (input.version !== undefined && input.version !== '1.0.0' || input.records.some((record) => !safeBrowserValue(record))) throw new Error('INVALID_BROWSER_DTO');
    const partial = input.completeness === 'partial' || input.records.some((record) => record['redacted'] === true || record['streamGap'] === true); return Object.freeze({ ...input, records: Object.freeze(input.records.map((record) => Object.freeze(JSON.parse(canonicalJson(record)) as Record<string, unknown>))), completeness: partial ? 'partial' : 'full' });
  }
  command(input: { owner: 'gateway' | 'memory'; name: string; expectedVersion: number; idempotencyKey: string; arguments: Record<string, unknown> }): { owner: 'gateway' | 'memory'; name: string; expectedVersion: number; idempotencyKey: string; arguments: Record<string, unknown> } {
    const allowed: Readonly<Record<string, readonly string[]>> = { gateway: ['install', 'disable', 'reauthorize', 'rotate', 'revoke'], memory: ['correct', 'export', 'hold', 'delete', 'restore', 'promote'] };
    const names = allowed[input.owner]; if (names === undefined || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || !input.idempotencyKey || !names.includes(input.name) || (['delete', 'restore'].includes(input.name) && (!Array.isArray(input.arguments['manifest']) || input.arguments['manifest'].length === 0))) throw new Error('INVALID_BROWSER_COMMAND');
    return Object.freeze({ ...input, arguments: JSON.parse(canonicalJson(input.arguments)) as Record<string, unknown> });
  }
}

export interface SafeImprovementProjection { tenantId: string; collection: 'evaluations' | 'improvements'; completeness: 'full' | 'partial'; version: string; records: readonly Record<string, unknown>[]; }
/** Read-only improvement state; stale or partial evidence cannot enable promotion. */
export class ImprovementWorkbench {
  ingest(input: SafeImprovementProjection): SafeImprovementProjection {
    tenantId(input.tenantId); if (input.version !== '1.0.0' || input.records.some((record) => !safeBrowserValue(record))) throw new Error('INVALID_BROWSER_DTO');
    const partial = input.completeness === 'partial' || input.records.some((record) => record['stale'] === true || record['partial'] === true || record['restricted'] === true);
    return Object.freeze({ ...input, completeness: partial ? 'partial' : 'full', records: Object.freeze(input.records.map((record) => Object.freeze(JSON.parse(canonicalJson(record)) as Record<string, unknown>))) });
  }
  command(input: { name: 'create' | 'evaluate' | 'shadow' | 'canary' | 'promote' | 'rollback'; expectedVersion: number; idempotencyKey: string; gateCurrent: boolean; r3Approved: boolean; arguments: Record<string, unknown> }): Readonly<typeof input> {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || !input.idempotencyKey || !input.gateCurrent || !input.r3Approved) throw new Error('INVALID_BROWSER_COMMAND');
    return Object.freeze({ ...input, arguments: JSON.parse(canonicalJson(input.arguments)) as Record<string, unknown> });
  }
}

export interface SafePackageProjection { tenantId: string; collection: 'packages' | 'installations'; completeness: 'full' | 'partial'; version: string; records: readonly Record<string, unknown>[]; }
export class PackageWorkbench {
  #tenantId: string | undefined;
  ingest(input: SafePackageProjection): SafePackageProjection {
    tenantId(input.tenantId);
    if (this.#tenantId !== undefined && this.#tenantId !== input.tenantId || input.version !== '1.0.0' || input.records.some((record) => !safeBrowserValue(record))) throw new Error('INVALID_BROWSER_DTO');
    this.#tenantId = input.tenantId;
    return Object.freeze({ ...input, records: Object.freeze(input.records.map((record) => Object.freeze(JSON.parse(canonicalJson(record)) as Record<string, unknown>))) });
  }
  draft(input: { tenantId: string; values: Record<string, unknown>; schemaKeys: readonly string[] }): { accepted: true; values: Record<string, unknown> } {
    if (input.tenantId !== this.#tenantId || Object.keys(input.values).some((key) => !input.schemaKeys.includes(key)) || !safeBrowserValue(input.values)) throw new Error('INVALID_BROWSER_DRAFT');
    return { accepted: true, values: JSON.parse(canonicalJson(input.values)) as Record<string, unknown> };
  }
  command(input: { name: 'activate' | 'quarantine' | 'retire'; expectedVersion: number; exactVersion: string; approvalCurrent: boolean; idempotencyKey: string; arguments: Record<string, unknown> }): Readonly<typeof input> {
    if (this.#tenantId === undefined || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || input.exactVersion !== '1.0.0' || !input.approvalCurrent || !input.idempotencyKey || !safeBrowserValue(input.arguments) || input.name === 'quarantine' && (!Array.isArray(input.arguments['manifest']) || input.arguments['manifest'].length === 0)) throw new Error('INVALID_BROWSER_COMMAND');
    return Object.freeze({ ...input, arguments: JSON.parse(canonicalJson(input.arguments)) as Record<string, unknown> });
  }
}

export interface SafeReadinessProjection { tenantId: string; collection: 'readiness' | 'deployments'; completeness: 'full' | 'partial'; version: '1.0.0'; records: readonly Record<string, unknown>[]; }
/** Readiness remains an evidence label, not an inference from a local projection. */
export class ReadinessWorkbench {
  ingest(input: SafeReadinessProjection): SafeReadinessProjection {
    tenantId(input.tenantId); if (input.records.some((record) => !safeBrowserValue(record) || typeof record['classification'] !== 'string' || !['fixture', 'live'].includes(record['classification']) || record['classification'] === 'live' && record['liveCertified'] !== true)) throw new Error('INVALID_BROWSER_DTO');
    const partial = input.completeness === 'partial' || input.records.some((record) => record['stale'] === true || record['unknownOutcome'] === true || record['restoreQuarantined'] === true || record['classification'] === 'fixture');
    return Object.freeze({ ...input, completeness: partial ? 'partial' : 'full', records: Object.freeze(input.records.map((record) => Object.freeze(JSON.parse(canonicalJson(record)) as Record<string, unknown>))) });
  }
  command(input: { name: 'reauthorize' | 'rotate' | 'reconcile' | 'deploy' | 'restore' | 'teardown'; expectedVersion: number; idempotencyKey: string; approvalCurrent: boolean; manifestDigest: string; arguments: Record<string, unknown> }): Readonly<typeof input> {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || !input.idempotencyKey || !input.approvalCurrent || !/^[a-f0-9]{64}$/u.test(input.manifestDigest) || (['restore', 'teardown'].includes(input.name) && !Array.isArray(input.arguments['manifest']))) throw new Error('INVALID_BROWSER_COMMAND'); return Object.freeze({ ...input, arguments: JSON.parse(canonicalJson(input.arguments)) as Record<string, unknown> });
  }
}

export interface SafeVendorCaseProjection { tenantId: string; collection: 'vendor-assessments' | 'access-grants'; completeness: 'full' | 'partial'; version: '1.0.0'; records: readonly Record<string, unknown>[]; }
/** Linked Case DTOs reject foreign references before a browser can display them. */
export class VendorCaseWorkbench {
  ingest(input: SafeVendorCaseProjection): SafeVendorCaseProjection {
    tenantId(input.tenantId); if (input.records.some((record) => !safeBrowserValue(record) || record['tenantId'] !== undefined && record['tenantId'] !== input.tenantId || input.collection === 'access-grants' && (typeof record['assessmentId'] !== 'string' || !Number.isSafeInteger(record['assessmentVersion'])))) throw new Error('INVALID_BROWSER_DTO');
    const partial = input.completeness === 'partial' || input.records.some((record) => record['stale'] === true || record['superseded'] === true || record['state'] === 'reconciliation-required' || record['state'] === 'revocation-pending');
    return Object.freeze({ ...input, completeness: partial ? 'partial' : 'full', records: Object.freeze(input.records.map((record) => Object.freeze(JSON.parse(canonicalJson(record)) as Record<string, unknown>))) });
  }
  command(input: { name: 'start' | 'approve' | 'provision' | 'revoke' | 'expire'; expectedVersion: number; idempotencyKey: string; assessmentCurrent: boolean; approvalCurrent: boolean; arguments: Record<string, unknown> }): Readonly<typeof input> {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || !input.idempotencyKey || !input.assessmentCurrent || !input.approvalCurrent || (['provision', 'revoke', 'expire'].includes(input.name) && typeof input.arguments['grantId'] !== 'string')) throw new Error('INVALID_BROWSER_COMMAND'); return Object.freeze({ ...input, arguments: JSON.parse(canonicalJson(input.arguments)) as Record<string, unknown> });
  }
}

const MEDIA_TYPE = 'application/vnd.platform.browser.v1+json';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const collections = new Set<string>(BROWSER_COLLECTIONS);
const groupCollections = new Set<string>(GROUP_COLLECTIONS);
const groupQueryKeys = new Set<string>(GROUP_QUERY_KEYS);
const GROUP_QUERY_VALUE_LIMIT = 200;
const GROUP_CURSOR_LIMIT = 2000;
export const BROWSER_V1_ROUTE_INVENTORY = Object.freeze([
  { method: 'GET', path: '/api/v1/session', owner: 'identity', action: 'identity.session.read', ready: true },
  { method: 'GET', path: '/api/v1/tenants', owner: 'identity', action: 'identity.membership.list', ready: true },
  { method: 'GET', path: '/api/v1/groups', owner: 'governance', action: 'governance.group.list', ready: true },
  { method: 'GET', path: '/api/v1/groups/:groupId/{members}', owner: 'governance', action: 'governance.group.read', ready: false },
  { method: 'POST', path: '/api/v1/groups/commands/governance/create-group', owner: 'governance', action: 'governance.group.create', ready: false },
  { method: 'POST', path: '/api/v1/groups/:groupId/commands/governance/:name', owner: 'governance', action: 'governance.group.command', ready: false },
  { method: 'GET', path: '/api/v1/tenants/:tenantId/{cases,interventions,capabilities,installations,memory,evaluations,improvements,packages,agent-teams,workflows,skills,test-runs,reviews,versions,operations,deployments,readiness,vendor-assessments,access-grants}[/:id]', owner: 'projection', action: 'projection.read', ready: false },
  { method: 'POST', path: '/api/v1/tenants/:tenantId/commands/:owner/:name', owner: 'named registry', action: 'owner.command', ready: false },
  { method: 'GET', path: '/api/v1/tenants/:tenantId/events', owner: 'operations', action: 'operations.events.read', ready: false },
]);

function header(request: BrowserRequest, name: string): string | undefined { return request.headers[name] ?? request.headers[name.toLowerCase()]; }
export class BrowserV1Transport {
  readonly #commands: Readonly<Record<string, BrowserCommandHandler>>; readonly #now: () => string; readonly #correlations = new WeakMap<BrowserRequest, string>();
  constructor(private readonly options: BrowserTransportOptions) { this.#commands = options.commands ?? {}; this.#now = options.now ?? (() => new Date().toISOString()); }

  async handle(request: BrowserRequest): Promise<BrowserResponse> {
    try {
      const url = new URL(request.path, 'https://platform.invalid'); const path = url.pathname;
      if (request.method === 'POST' || path.endsWith('/events')) this.assertOrigin(request);
      if (path === '/api/v1/session') return await this.session(request);
      if (path === '/api/v1/tenants') return await this.tenants(request);
      if (path === '/api/v1/groups' && request.method === 'GET') return await this.groups(request);
      const groupRead = request.method === 'GET' ? /^\/api\/v1\/groups\/([^/]+)\/([^/]+)$/u.exec(path) : null;
      if (groupRead !== null) return await this.groupRead(request, url, this.groupId(groupRead[1] ?? ''), groupRead[2] ?? '');
      const groupCommand = request.method === 'POST' ? /^\/api\/v1\/groups\/(?:commands\/governance\/(create-group)|([^/]+)\/commands\/governance\/(?!create-group$)([a-z][a-z0-9-]*))$/u.exec(path) : null;
      if (groupCommand !== null) return await this.groupCommand(request, groupCommand[2] === undefined ? undefined : this.decodeSegment(groupCommand[2]), groupCommand[1] ?? groupCommand[3] ?? '');
      const match = /^\/api\/v1\/tenants\/([^/]+)(?:\/(.*))?$/u.exec(path); if (match === null) throw new AppError('NOT_FOUND');
      const routeTenant = tenantId(this.decodeSegment(match[1] ?? ''));
      const tail = match[2] ?? ''; const query = this.validateQuery(url, routeTenant);
      if (request.method === 'GET' && tail === 'events') return await this.featureNotReady(request, routeTenant);
      if (request.method === 'GET' && this.collectionRoute(tail)) return await this.projection(request, String(routeTenant), tail, query);
      if (request.method === 'POST' && tail === 'openrouter-connection') return await this.connection(request, String(routeTenant));
      const commandRoute = /^commands\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)$/u.exec(tail);
      if (request.method !== 'POST' || commandRoute === null) throw new AppError('NOT_FOUND');
      return await this.command(request, String(routeTenant), commandRoute[1] ?? '', commandRoute[2] ?? '');
    } catch (error) { const app = classify(error); this.options.onError?.(error, this.errorContext(request)); return await this.error(request, app.status, app.toBody(), this.routeTenant(request)); }
  }

  private decodeSegment(segment: string): string { try { return decodeURIComponent(segment); } catch (error) { throw new AppError('INVALID_IDENTIFIER', { cause: error }); } }
  private collectionRoute(tail: string): boolean { const [collection, id, extra] = tail.split('/'); return collection !== undefined && collections.has(collection) && extra === undefined && (id === undefined || UUID.test(id)); }
  private async proof(request: BrowserRequest): Promise<Proof | undefined> { if (this.options.clerk === undefined || this.options.identity === undefined) return undefined; const authorization = header(request, 'authorization'); if (!authorization?.startsWith('Bearer ') || authorization.length < 8) throw new AppError('UNAUTHENTICATED'); return this.options.clerk.proof(authorization.slice(7), header(request, 'origin')); }
  private async context(request: BrowserRequest, selectedTenant: string): Promise<ExecutionContext | undefined> { const proof = await this.proof(request); return proof === undefined || this.options.identity === undefined ? undefined : this.options.identity.authenticate(proof, selectedTenant, 'platform-browser-api', this.#now()); }
  private async session(request: BrowserRequest): Promise<BrowserResponse> { if (this.options.clerk === undefined || this.options.identity === undefined) return this.featureNotReady(request, undefined); const authorization = header(request, 'authorization'); if (!authorization?.startsWith('Bearer ')) throw new AppError('UNAUTHENTICATED'); const proof = await this.options.clerk.proof(authorization.slice(7), header(request, 'origin')); const user = await this.options.identity.authenticate(proof, header(request, 'x-platform-tenant') ?? await this.firstTenant(proof), 'platform-browser-api', this.#now()); return this.success(request, String(user.tenantId), { user: { id: user.userId }, tenant: { id: user.tenantId, epoch: user.tenantEpoch }, actionHints: [] }); }
  private async tenants(request: BrowserRequest): Promise<BrowserResponse> { if (this.options.clerk === undefined || this.options.identity === undefined) return this.featureNotReady(request, undefined); const authorization = header(request, 'authorization'); if (!authorization?.startsWith('Bearer ')) throw new AppError('UNAUTHENTICATED'); const proof = await this.options.clerk.proof(authorization.slice(7), header(request, 'origin')); const memberships = await this.options.identity.membershipsForProof(proof); const selected = String(memberships[0]?.tenantId ?? ''); const context = await this.options.identity.authenticate(proof, selected, 'platform-browser-api', this.#now()); return this.success(request, String(context.tenantId), { tenants: memberships.map((membership) => ({ id: membership.tenantId, profiles: membership.profiles, epoch: membership.epoch })) }); }
  private async groups(request: BrowserRequest): Promise<BrowserResponse> {
    const proof = await this.proof(request); if (proof === undefined || this.options.identity === undefined) return this.featureNotReady(request, undefined);
    const groups = await this.options.identity.groupsForProof(proof);
    return this.success(request, undefined, { groups: groups.map((group) => ({ id: group.id, name: group.name, epoch: group.epoch, adminEpoch: group.adminEpoch, tenantIds: group.tenantIds, ...(group.billingTenantId === undefined ? {} : { billingTenantId: group.billingTenantId }) })), completeness: 'full' });
  }
  private async groupCommand(request: BrowserRequest, groupId: string | undefined, name: string): Promise<BrowserResponse> {
    const authorization = header(request, 'authorization'); const key = header(request, 'idempotency-key'); const correlation = header(request, 'x-correlation-id'); const contentType = header(request, 'content-type');
    if (!authorization?.startsWith('Bearer ') || authorization.length < 8) throw new AppError('UNAUTHENTICATED');
    if (key === undefined || !UUID.test(key) || !UUID.test(correlation ?? '') || contentType !== MEDIA_TYPE || request.body === undefined) throw new Error('DENIED');
    const identity = this.options.identity; if (this.options.clerk === undefined || identity === undefined) return this.featureNotReady(request, undefined);
    const payload = decodeContract(descriptorFor('governance.v1'), request.body).payload; const expectedVersion = payload['expectedVersion']; const argumentsValue = payload['arguments']; const ifMatch = header(request, 'if-match');
    if (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion) || expectedVersion < 0 || ifMatch !== String(expectedVersion) || argumentsValue === null || Array.isArray(argumentsValue) || typeof argumentsValue !== 'object' || Buffer.byteLength(canonicalJson(argumentsValue)) > 65536) throw new Error('STALE');
    const handler = this.options.groupCommands?.[`governance.${name}`]; if (handler === undefined) return this.featureNotReady(request, undefined);
    const validatedArguments = decodeCommandArguments('governance', name, argumentsValue); const proof = await this.proof(request); if (proof === undefined) return this.featureNotReady(request, undefined);
    const command: GroupCommand = { userId: '', name, idempotencyKey: key, correlationId: correlationId(correlation), expectedVersion, digest: await digest(validatedArguments), arguments: validatedArguments };
    if (groupId === undefined) {
      if (expectedVersion !== 0) throw new Error('STALE');
      const actor = await identity.authenticate(proof, String((validatedArguments['tenantIds'] as string[])[0]), 'platform-browser-api', this.#now());
      return this.success(request, undefined, await handler({ ...command, userId: actor.userId }));
    }
    const session = await identity.authenticateGroup(proof, groupId, 'platform-browser-api', this.#now());
    const current = await identity.authenticateGroup(proof, groupId, 'platform-browser-api', this.#now());
    if (current.groupEpoch !== session.groupEpoch || current.adminEpoch !== session.adminEpoch) throw new Error('STALE');
    return this.success(request, undefined, await handler({ ...command, userId: current.userId, group: current }));
  }
  private groupId(segment: string): string { const value = this.decodeSegment(segment); if (!UUID.test(value)) throw new AppError('INVALID_IDENTIFIER'); return value.toLowerCase(); }
  private groupQuery(url: URL): Readonly<Record<string, string>> {
    const query: Record<string, string> = {};
    for (const [key, value] of url.searchParams) {
      if (!groupQueryKeys.has(key) || Object.hasOwn(query, key) || value.length > (key === 'cursor' ? GROUP_CURSOR_LIMIT : GROUP_QUERY_VALUE_LIMIT)) throw new AppError('INVALID');
      query[key] = value;
    }
    return Object.freeze(query);
  }
  private async groupRead(request: BrowserRequest, url: URL, groupId: string, collection: string): Promise<BrowserResponse> {
    if (!groupCollections.has(collection)) throw new AppError('NOT_FOUND');
    const query = this.groupQuery(url); const proof = await this.proof(request);
    if (proof === undefined || this.options.identity === undefined) return this.featureNotReady(request, undefined);
    const context = await this.options.identity.authenticateGroup(proof, groupId, 'platform-browser-api', this.#now());
    if (this.options.groupProjections === undefined) return this.featureNotReady(request, undefined);
    return this.success(request, undefined, { ...await this.options.groupProjections({ context, collection, query }), groupId, collection });
  }
  private async firstTenant(proof: Proof): Promise<string> { if (this.options.identity === undefined) throw new Error('DENIED'); const membership = (await this.options.identity.membershipsForProof(proof))[0]; if (membership === undefined) throw new Error('DENIED'); return String(membership.tenantId); }
  private async projection(request: BrowserRequest, routeTenant: string, tail: string, query: { pageSize?: number; cursor?: string }): Promise<BrowserResponse> { const [collection, id] = tail.split('/'); const context = await this.context(request, routeTenant); if (context === undefined || collection === undefined || this.options.projections === undefined) return this.featureNotReady(request, routeTenant); return this.success(request, routeTenant, await this.options.projections({ context, collection, ...(id === undefined ? {} : { id }), ...query })); }
  private validateQuery(url: URL, routeTenant: string): { pageSize?: number; cursor?: string } {
    const pageSize = url.searchParams.get('pageSize'); if (pageSize !== null && (!/^[1-9][0-9]*$/u.test(pageSize) || Number(pageSize) > 100)) throw new Error('INVALID_PAGE_SIZE');
    const cursor = url.searchParams.get('cursor'); if (cursor !== null) { if (!/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new Error('INVALID_CURSOR'); const decoded = Buffer.from(cursor, 'base64url').toString('utf8'); if (!decoded.startsWith(`${routeTenant}.`)) throw new Error('TENANT_MISMATCH'); }
    return { ...(pageSize === null ? {} : { pageSize: Number(pageSize) }), ...(cursor === null ? {} : { cursor }) };
  }
  private assertOrigin(request: BrowserRequest): void { const origin = header(request, 'origin'); if (origin === undefined || !this.options.allowedOrigins.includes(origin)) throw new Error('DENIED'); }
  private async command(request: BrowserRequest, routeTenant: string, owner: string, name: string): Promise<BrowserResponse> {
    const authorization = header(request, 'authorization'); const key = header(request, 'idempotency-key'); const correlation = header(request, 'x-correlation-id'); const contentType = header(request, 'content-type');
    if (!authorization?.startsWith('Bearer ') || authorization.length < 8) throw new AppError('UNAUTHENTICATED');
    if (key === undefined || !UUID.test(key) || !UUID.test(correlation ?? '') || contentType !== MEDIA_TYPE || request.body === undefined) throw new Error('DENIED');
    const context = await this.context(request, routeTenant); if (context === undefined) return this.featureNotReady(request, routeTenant); const envelope = decodeContract(descriptorFor('browser.v1'), request.body, routeTenant);
    const payload = envelope.payload; const expectedVersion = payload['expectedVersion']; const argumentsValue = payload['arguments']; const ifMatch = header(request, 'if-match');
    if (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion) || expectedVersion < 0 || ifMatch !== String(expectedVersion) || argumentsValue === null || Array.isArray(argumentsValue) || typeof argumentsValue !== 'object' || Buffer.byteLength(canonicalJson(argumentsValue)) > 65536) throw new Error('STALE'); const version = expectedVersion;
    const handler = this.#commands[`${owner}.${name}`]; if (handler === undefined) return this.featureNotReady(request, routeTenant);
    const validatedArguments = hasCommandArgumentSchema(owner, name) ? decodeCommandArguments(owner, name, argumentsValue) : argumentsValue as Record<string, unknown>;
    const command: BrowserCommand = { context, tenantId: routeTenant, owner, name, idempotencyKey: key, correlationId: correlationId(correlation), expectedVersion: version, digest: await digest(validatedArguments), arguments: validatedArguments, envelope };
    const current = await this.context(request, routeTenant); if (current === undefined || current.tenantEpoch !== context.tenantEpoch || current.membershipEpoch !== context.membershipEpoch) throw new Error('STALE'); return this.success(request, routeTenant, await handler({ ...command, context: current }));
  }
  private async connection(request: BrowserRequest, routeTenant: string): Promise<BrowserResponse> {
    const key = header(request, 'idempotency-key'); const contentType = header(request, 'content-type');
    if (!key || !UUID.test(key) || contentType !== 'application/json' || !request.body || !this.options.connections) throw new Error('DENIED');
    let body: unknown; try { body = JSON.parse(Buffer.from(request.body).toString('utf8')); } catch (error) { throw new AppError('INVALID_JSON', { cause: error }); } if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INVALID');
    const value = body as Record<string, unknown>; const action = value['action']; const expectedVersion = value['expectedVersion']; const secret = value['key'];
    if (!['connect', 'rotate', 'verify', 'disconnect'].includes(String(action)) || !Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 0 || (secret !== undefined && (typeof secret !== 'string' || secret.length > 4096)) || ((action === 'connect' || action === 'rotate') && typeof secret !== 'string')) throw new Error('INVALID');
    const context = await this.context(request, routeTenant); if (!context) return this.featureNotReady(request, routeTenant);
    return this.success(request, routeTenant, await this.options.connections({ context, action: action as 'connect' | 'rotate' | 'verify' | 'disconnect', expectedVersion: expectedVersion as number, idempotencyKey: key, ...(typeof secret === 'string' ? { key: secret } : {}) }));
  }
  private async featureNotReady(request: BrowserRequest, selectedTenant: string | undefined): Promise<BrowserResponse> { const app = new AppError('FEATURE_NOT_READY'); return this.error(request, app.status, app.toBody(), selectedTenant); }
  private async success(request: BrowserRequest, selectedTenant: string | undefined, payload: Record<string, unknown>): Promise<BrowserResponse> { return this.response(request, 200, selectedTenant, payload); }
  private async error(request: BrowserRequest, status: number, error: NormalizedError, selectedTenant?: string): Promise<BrowserResponse> { return this.response(request, status, selectedTenant, { error }); }
  private correlation(request: BrowserRequest): string { let id = this.#correlations.get(request); if (id === undefined) { id = correlationIdFrom(header(request, 'x-correlation-id')); this.#correlations.set(request, id); } return id; }
  private routeTenant(request: BrowserRequest): string | undefined { const candidate = /^\/api\/v1\/tenants\/([^/?]+)/u.exec(request.path)?.[1]; return candidate !== undefined && UUID.test(candidate) ? candidate.toLowerCase() : undefined; }
  private errorContext(request: BrowserRequest): ErrorContext { const tenant = this.routeTenant(request); return { correlationId: this.correlation(request), ...(tenant === undefined ? {} : { tenantId: tenant }), method: request.method, route: request.path.split('?')[0] ?? request.path }; }
  private async response(request: BrowserRequest, status: number, selectedTenant: string | undefined, payload: Record<string, unknown>): Promise<BrowserResponse> {
    const id = this.correlation(request); const descriptor = descriptorFor(request.path.startsWith('/api/v1/groups') ? 'governance.v1' : 'browser.v1');
    const safePayload = JSON.parse(canonicalJson(payload)) as Record<string, unknown>;
    const envelope: ContractEnvelope = { messageId: messageId(id), contract: descriptor.name, contractVersion: '1.0.0', occurredAt: this.#now(), sender: 'browser-transport', classification: 'restricted-operational', payload: { ...safePayload, completeness: safePayload['completeness'] ?? 'not-ready' } };
    if (descriptor.tenantScoped) envelope.tenantId = tenantId(selectedTenant ?? '11111111-1111-4111-8111-111111111111'); envelope.correlationId = correlationId(id);
    const encoded = await encodeContract(descriptor, envelope);
    return { status, headers: { 'content-type': MEDIA_TYPE, 'x-contract-version': '1.0.0', 'x-correlation-id': id }, body: encoded.bytes };
  }
}
