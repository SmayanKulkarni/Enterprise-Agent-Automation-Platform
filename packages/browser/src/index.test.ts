import { Buffer } from 'node:buffer';
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { BROWSER_COLLECTIONS } from './browser-contracts.js';
import { BrowserV1Transport, ClerkSessionAdapter, liveClerkSessionAdapter, type BrowserTransportOptions, type ClerkBackend, type GroupCommand, type GroupProjection } from './index.js';
import { decodeContract, descriptorFor } from '../../contracts/src/index.js';
import { IdentityStore } from '../../identity/src/index.js';
import { GovernanceService } from '../../governance/src/service.js';

let stdout: { mock: { calls: unknown[][] } };
beforeEach(() => { stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); trace.disable(); metrics.disable(); context.disable(); propagation.disable(); });

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const origin = 'https://app.example';

const groupId = 'a0000000-0000-4000-8000-000000000001';

function identityStore(groupAdmins?: readonly string[]): IdentityStore {
  const identity = new IdentityStore();
  identity.provision(tenantId);
  identity.transition(tenantId, 1, 'activate');
  identity.mapUser('https://clerk.example', userId, userId);
  identity.membership(tenantId, userId, ['admin']);
  identity.setMembership(tenantId, userId, 1, 'current');
  if (groupAdmins !== undefined) identity.group(groupId, 'Local group', [tenantId], groupAdmins);
  return identity;
}

function transport(extra: Partial<BrowserTransportOptions> = {}, groupAdmins?: readonly string[]): BrowserV1Transport {
  const identity = identityStore(groupAdmins);
  const clerk = new ClerkSessionAdapter({ issuer: 'https://clerk.example', publishableKey: 'pk_test', audience: 'platform-browser-api', authorizedParties: [origin] }, {
    verifySessionToken: () => ({ issuer: 'https://clerk.example', subject: userId, sessionId: userId, audience: 'platform-browser-api', expiresAt: '2099-01-01T00:00:00.000Z', tokenUse: 'session', authorizedParty: origin }),
    getSession: () => ({ subject: userId, status: 'active' }),
  });
  return new BrowserV1Transport({ allowedOrigins: [origin], clerk, identity, projections: ({ context, collection }) => ({ tenantId: String(context.tenantId), collection, records: [], completeness: 'full', classification: 'ordinary', freshness: 'current', redaction: 'none' }), ...extra });
}

test('serves every declared projection collection to an authenticated member', async () => {
  const browser = transport();
  const responses = await Promise.all(BROWSER_COLLECTIONS.map((collection) => browser.handle({ method: 'GET', path: `/api/v1/tenants/${tenantId}/${collection}`, headers: { authorization: `Bearer ${userId}`, origin } })));

  expect(responses.map((response) => response.status)).toEqual(BROWSER_COLLECTIONS.map(() => 200));
});

test('reports a not-ready feature as 501 and passes the cause to onError', async () => {
  const causes: unknown[] = [];
  const browser = transport({ connections: () => Promise.reject(Object.assign(new Error('FEATURE_NOT_READY'), { code: 'FEATURE_NOT_READY' })), onError: (error) => causes.push(error) });
  const response = await browser.handle({ method: 'POST', path: `/api/v1/tenants/${tenantId}/openrouter-connection`, headers: { authorization: `Bearer ${userId}`, origin, 'content-type': 'application/json', 'idempotency-key': '33333333-3333-4333-8333-333333333333' }, body: new TextEncoder().encode(JSON.stringify({ action: 'connect', expectedVersion: 0, key: 'fake' })) });

  expect(response.status).toBe(501);
  expect(causes).toHaveLength(1);
});

const correlation = '44444444-4444-4444-8444-444444444444';
const errorOf = (response: { body: Uint8Array }): Record<string, unknown> => ((JSON.parse(new TextDecoder().decode(response.body)) as { payload: { error: Record<string, unknown> } }).payload.error);
const get = (browser: BrowserV1Transport, path: string, headers: Record<string, string> = { authorization: `Bearer ${userId}`, origin }) => browser.handle({ method: 'GET', path, headers });

test.each([
  ['a missing bearer token', `/api/v1/session`, { origin }, 401, 'UNAUTHENTICATED', 'denied'],
  ['a missing bearer token on a projection', `/api/v1/tenants/${tenantId}/cases`, { origin }, 401, 'UNAUTHENTICATED', 'denied'],
  ['a bad cursor', `/api/v1/tenants/${tenantId}/cases?cursor=***`, { authorization: `Bearer ${userId}`, origin }, 422, 'INVALID_CURSOR', 'invalid'],
  ['a foreign cursor', `/api/v1/tenants/${tenantId}/cases?cursor=${Buffer.from('other.1').toString('base64url')}`, { authorization: `Bearer ${userId}`, origin }, 403, 'DENIED', 'denied'],
  ['a bad page size', `/api/v1/tenants/${tenantId}/cases?pageSize=500`, { authorization: `Bearer ${userId}`, origin }, 422, 'INVALID_PAGE_SIZE', 'invalid'],
  ['a malformed tenant escape', `/api/v1/tenants/%zz/cases`, { authorization: `Bearer ${userId}`, origin }, 403, 'DENIED', 'denied'],
  ['an unknown route', `/api/v1/tenants/${tenantId}/nothing`, { authorization: `Bearer ${userId}`, origin }, 404, 'NOT_FOUND', 'invalid'],
  ['an unknown top-level route', `/api/v1/nothing`, { authorization: `Bearer ${userId}`, origin }, 404, 'NOT_FOUND', 'invalid'],
])('answers %s with the mapped status and code', async (_name, path, headers, status, code, category) => {
  const response = await get(transport(), path, headers);

  expect(response.status).toBe(status);
  expect(errorOf(response)).toMatchObject({ code, category, redacted: true });
});

test('answers a stale if-match with 409 and the same correlation id', async () => {
  const body = { messageId: correlation, contract: 'browser.v1', contractVersion: '1.0.0', occurredAt: '2026-01-01T00:00:00.000Z', tenantId, correlationId: correlation, sender: 'platform-browser', classification: 'restricted-operational', payload: { expectedVersion: 0, arguments: {} } };
  const response = await transport().handle({ method: 'POST', path: `/api/v1/tenants/${tenantId}/commands/workflow/publish`, headers: { authorization: `Bearer ${userId}`, origin, 'content-type': 'application/vnd.platform.browser.v1+json', 'idempotency-key': '33333333-3333-4333-8333-333333333333', 'x-correlation-id': correlation, 'if-match': '5' }, body: new TextEncoder().encode(JSON.stringify(body)) });

  expect(response.status).toBe(409);
  expect(response.headers['x-correlation-id']).toBe(correlation);
  expect(errorOf(response)).toMatchObject({ code: 'STALE', category: 'conflict' });
});

test('answers malformed connection JSON with 400', async () => {
  const response = await transport({ connections: () => Promise.resolve({}) }).handle({ method: 'POST', path: `/api/v1/tenants/${tenantId}/openrouter-connection`, headers: { authorization: `Bearer ${userId}`, origin, 'content-type': 'application/json', 'idempotency-key': '33333333-3333-4333-8333-333333333333' }, body: new TextEncoder().encode('{nope') });

  expect(response.status).toBe(400);
  expect(errorOf(response)).toMatchObject({ code: 'INVALID_JSON' });
});

test('gives each uncorrelated failure its own correlation id and passes it to onError', async () => {
  const seen: { correlationId?: string; tenantId?: string; method?: string; route?: string }[] = [];
  const browser = transport({ onError: (_error, context) => seen.push(context) });
  const first = await get(browser, `/api/v1/tenants/${tenantId}/nothing`);
  const second = await get(browser, `/api/v1/tenants/${tenantId}/nothing`);

  expect(first.headers['x-correlation-id']).not.toBe(second.headers['x-correlation-id']);
  expect(seen[0]).toEqual({ correlationId: first.headers['x-correlation-id'], tenantId, method: 'GET', route: `/api/v1/tenants/${tenantId}/nothing` });
});

const clerkEnvironment = { CLERK_ISSUER: 'https://clerk.example', CLERK_PUBLISHABLE_KEY: 'pk_test', CLERK_SECRET_KEY: 'sk_test', CLERK_AUDIENCE: 'platform-browser-api', CLERK_AUTHORIZED_PARTIES: origin };
const claims = { iss: 'https://clerk.example', sub: userId, sid: userId, azp: origin, exp: 4_102_444_800 };

test.each([
  ['an expired token', { verifyToken: () => Promise.reject(Object.assign(new Error('expired'), { reason: 'token-expired' })), sessions: { getSession: () => Promise.resolve({ userId, status: 'active' }) } }, 401],
  ['a deleted session', { verifyToken: () => Promise.resolve(claims), sessions: { getSession: () => Promise.reject(Object.assign(new Error('not found'), { status: 404 })) } }, 401],
  ['a Clerk outage', { verifyToken: () => Promise.reject(Object.assign(new Error('down'), { reason: 'jwk-remote-failed-to-load' })), sessions: { getSession: () => Promise.resolve({ userId, status: 'active' }) } }, 500],
] satisfies [string, ClerkBackend, number][])('live Clerk adapter answers %s with %i', async (_name, backend, status) => {
  const response = await get(transport({ clerk: liveClerkSessionAdapter(clerkEnvironment, backend) }), '/api/v1/session');

  expect(response.status).toBe(status);
});

const payloadOf = (response: { body: Uint8Array }): Record<string, unknown> => (JSON.parse(new TextDecoder().decode(response.body)) as { payload: Record<string, unknown> }).payload;

test('lists the groups a user administers in a governance.v1 envelope without a tenant id', async () => {
  const response = await get(transport({}, [userId]), '/api/v1/groups');
  const envelope = decodeContract(descriptorFor('governance.v1'), response.body);

  expect(response.status).toBe(200);
  expect(envelope.contract).toBe('governance.v1');
  expect(envelope.tenantId).toBeUndefined();
  expect(envelope.payload).toEqual({ groups: [{ id: groupId, name: 'Local group', epoch: 1, adminEpoch: 1, tenantIds: [tenantId] }], completeness: 'full' });
});

test('answers 200 with an empty list for a user in no group', async () => {
  const response = await get(transport(), '/api/v1/groups');

  expect(response.status).toBe(200);
  expect(payloadOf(response)['groups']).toEqual([]);
});

test('answers 401 without a bearer token on group routes in a governance.v1 envelope', async () => {
  const response = await get(transport({}, [userId]), '/api/v1/groups', { origin });

  expect(response.status).toBe(401);
  expect(decodeContract(descriptorFor('governance.v1'), response.body).tenantId).toBeUndefined();
});

test('keeps browser.v1 envelopes on tenant routes', async () => {
  const response = await get(transport({}, [userId]), '/api/v1/tenants');

  expect(decodeContract(descriptorFor('browser.v1'), response.body, tenantId).contract).toBe('browser.v1');
});

const commandBody = (expectedVersion: number, args: Record<string, unknown>) => ({ messageId: correlation, contract: 'governance.v1', contractVersion: '1.0.0', occurredAt: '2026-01-01T00:00:00.000Z', correlationId: correlation, sender: 'platform-browser', classification: 'restricted-operational', payload: { expectedVersion, arguments: args } });
const commandHeaders = { authorization: `Bearer ${userId}`, origin, 'content-type': 'application/vnd.platform.browser.v1+json', 'idempotency-key': '33333333-3333-4333-8333-333333333333', 'x-correlation-id': correlation, 'if-match': '1' };
const postGroup = (browser: BrowserV1Transport, path: string, body: unknown, headers: Record<string, string | undefined> = commandHeaders) => browser.handle({ method: 'POST', path, headers, body: new TextEncoder().encode(JSON.stringify(body)) });
const addTenantPath = `/api/v1/groups/${groupId}/commands/governance/add-tenant`;
const otherTenant = '55555555-5555-4555-8555-555555555555';
const okReceipt = { commandId: 'c', objectId: groupId, revision: 2, state: 'tenant-added', digest: 'd', evidenceIds: [] };

test('runs a group command with validated arguments, the group session and the unchanged expected version', async () => {
  const seen: GroupCommand[] = [];
  const browser = transport({ groupCommands: { 'governance.add-tenant': (command) => { seen.push(command); return Promise.resolve(okReceipt); } } }, [userId]);
  const response = await postGroup(browser, addTenantPath, commandBody(1, { tenantId: otherTenant }));

  expect(response.status).toBe(200);
  expect(decodeContract(descriptorFor('governance.v1'), response.body).tenantId).toBeUndefined();
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ userId, name: 'add-tenant', expectedVersion: 1, arguments: { tenantId: otherTenant }, group: { groupId, groupEpoch: 1, adminEpoch: 1 } });
});

test.each([
  ['a non-admin of the group', [], addTenantPath],
  ['a foreign group id', [userId], `/api/v1/groups/66666666-6666-4666-8666-666666666666/commands/governance/add-tenant`],
])('refuses a group command from %s with 403', async (_name, admins, path) => {
  const browser = transport({ groupCommands: { 'governance.add-tenant': () => Promise.resolve(okReceipt) } }, admins);
  const response = await postGroup(browser, path, commandBody(1, { tenantId: otherTenant }));

  expect(response.status).toBe(403);
});

test.each([
  ['a missing origin', { ...commandHeaders, origin: undefined }],
  ['a missing idempotency key', { ...commandHeaders, 'idempotency-key': undefined }],
  ['a non-UUID correlation id', { ...commandHeaders, 'x-correlation-id': 'nope' }],
  ['a wrong content type', { ...commandHeaders, 'content-type': 'application/json' }],
])('refuses a group command with %s', async (_name, headers) => {
  const browser = transport({ groupCommands: { 'governance.add-tenant': () => Promise.resolve(okReceipt) } }, [userId]);
  const response = await postGroup(browser, addTenantPath, commandBody(1, { tenantId: otherTenant }), headers);

  expect(response.status).toBe(403);
});

test('refuses a group command without a bearer token with 401', async () => {
  const browser = transport({ groupCommands: { 'governance.add-tenant': () => Promise.resolve(okReceipt) } }, [userId]);

  expect((await postGroup(browser, addTenantPath, commandBody(1, { tenantId: otherTenant }), { ...commandHeaders, authorization: undefined })).status).toBe(401);
});

const assistantPath = `/api/v1/groups/${groupId}/assistant`;
const assistantHeaders = { authorization: `Bearer ${userId}`, origin, 'content-type': 'application/json', 'idempotency-key': '33333333-3333-4333-8333-333333333333', 'x-correlation-id': correlation };
const assistantAnswer = { answer: 'Spend rose.', model: 'm', tokens: 5, cost: 0.01 };
const askRoute = (browser: BrowserV1Transport, body: string, headers: Record<string, string | undefined> = assistantHeaders) => browser.handle({ method: 'POST', path: assistantPath, headers, body: new TextEncoder().encode(body) });

test('answers an assistant turn for a group admin and passes the group context and parsed body', async () => {
  const seen: { groupId: string; body: unknown }[] = [];
  const browser = transport({ assistant: ({ context, body }) => { seen.push({ groupId: context.groupId, body }); return Promise.resolve(assistantAnswer); } }, [userId]);
  const response = await askRoute(browser, '{"question":1}');

  expect(response.status).toBe(200);
  expect(payloadOf(response)).toMatchObject({ groupId, ...assistantAnswer, completeness: 'full' });
  expect(seen).toEqual([{ groupId, body: { question: 1 } }]);
});

test('refuses an assistant turn from a non-admin with 403 before calling the handler', async () => {
  const handler = vi.fn(() => Promise.resolve(assistantAnswer));

  expect((await askRoute(transport({ assistant: handler }, []), '{}')).status).toBe(403);
  expect(handler).not.toHaveBeenCalled();
});

test.each([
  ['a missing origin', { ...assistantHeaders, origin: undefined }],
  ['a missing idempotency key', { ...assistantHeaders, 'idempotency-key': undefined }],
  ['a non-UUID correlation id', { ...assistantHeaders, 'x-correlation-id': 'nope' }],
  ['a wrong content type', { ...assistantHeaders, 'content-type': 'text/plain' }],
])('refuses an assistant turn with %s', async (_name, headers) => {
  expect((await askRoute(transport({ assistant: () => Promise.resolve(assistantAnswer) }, [userId]), '{}', headers)).status).toBe(403);
});

test('refuses an assistant turn without a bearer token with 401', async () => {
  expect((await askRoute(transport({ assistant: () => Promise.resolve(assistantAnswer) }, [userId]), '{}', { ...assistantHeaders, authorization: undefined })).status).toBe(401);
});

test.each([
  ['not JSON', 'nope', 400],
  ['a JSON array', '[]', 422],
  ['over 65536 bytes', JSON.stringify({ text: 'a'.repeat(70_000) }), 422],
])('answers an assistant turn whose body is %s with %i', async (_name, body, status) => {
  expect((await askRoute(transport({ assistant: () => Promise.resolve(assistantAnswer) }, [userId]), body)).status).toBe(status);
});

test('labels the assistant route with its template', async () => {
  const { points } = observe();
  await askRoute(transport({ assistant: () => Promise.resolve(assistantAnswer) }, [userId]), '{}');

  expect((await points('http.server.request.duration')).map((point) => point.attributes['http.route'])).toEqual(['/api/v1/groups/:groupId/assistant']);
});

test('maps handler errors to their status and answers 501 without a handler', async () => {
  const fail = (code: string) => transport({ assistant: () => Promise.reject(Object.assign(new Error(code), { code })) }, [userId]);

  expect((await askRoute(fail('INVALID'), '{}')).status).toBe(422);
  expect((await askRoute(fail('RATE_LIMITED'), '{}')).status).toBe(429);
  expect((await askRoute(transport({}, [userId]), '{}')).status).toBe(501);
});

test('answers 409 when if-match differs from the expected version', async () => {
  const browser = transport({ groupCommands: { 'governance.add-tenant': () => Promise.resolve(okReceipt) } }, [userId]);

  expect((await postGroup(browser, addTenantPath, commandBody(1, { tenantId: otherTenant }), { ...commandHeaders, 'if-match': '5' })).status).toBe(409);
});

test('answers 409 when the group epoch changes between the two session reads', async () => {
  const base = identityStore([userId]); let reads = 0;
  const identity = Object.assign(Object.create(base) as IdentityStore, { authenticateGroup: (...input: Parameters<IdentityStore['authenticateGroup']>) => { const context = base.authenticateGroup(...input); reads += 1; return reads > 1 ? { ...context, groupEpoch: context.groupEpoch + 1 } : context; } });
  const browser = transport({ identity, groupCommands: { 'governance.add-tenant': () => Promise.resolve(okReceipt) } }, [userId]);

  expect((await postGroup(browser, addTenantPath, commandBody(1, { tenantId: otherTenant }))).status).toBe(409);
});

test('answers 501 for a group command when no handlers are registered', async () => {
  expect((await postGroup(transport({}, [userId]), addTenantPath, commandBody(1, { tenantId: otherTenant }))).status).toBe(501);
});

test('rejects invalid group command arguments with 422', async () => {
  const browser = transport({ groupCommands: { 'governance.add-tenant': () => Promise.resolve(okReceipt) } }, [userId]);

  expect((await postGroup(browser, addTenantPath, commandBody(1, { tenantId: 'nope' }))).status).toBe(422);
});

test('creates a group as the caller authenticated against the first listed workspace', async () => {
  const seen: GroupCommand[] = [];
  const browser = transport({ groupCommands: { 'governance.create-group': (command) => { seen.push(command); return Promise.resolve(okReceipt); } } });
  const args = { name: 'Platform', tenantIds: [tenantId], billingTenantId: null };
  const created = await postGroup(browser, '/api/v1/groups/commands/governance/create-group', commandBody(0, args), { ...commandHeaders, 'if-match': '0' });

  expect(created.status).toBe(200);
  expect(seen[0]).toMatchObject({ userId, name: 'create-group', expectedVersion: 0, arguments: args });
  expect(seen[0]?.group).toBeUndefined();
  expect((await postGroup(browser, '/api/v1/groups/commands/governance/create-group', commandBody(1, args))).status).toBe(409);
});

test('refuses to create a group in a workspace the caller is not a member of', async () => {
  const browser = transport({ groupCommands: { 'governance.create-group': () => Promise.resolve(okReceipt) } });
  const response = await postGroup(browser, '/api/v1/groups/commands/governance/create-group', commandBody(0, { name: 'Platform', tenantIds: [otherTenant], billingTenantId: null }), { ...commandHeaders, 'if-match': '0' });

  expect(response.status).toBe(403);
});

const membersPath = `/api/v1/groups/${groupId}/members`;
const membersPayload = { workspaces: [{ tenantId, name: 'one', joinedAt: '2026-01-01T00:00:00.000Z', billing: false }], admins: [], eligible: [] };
const groupProjections = (seen: GroupProjection[] = []) => ({ groupProjections: (projection: GroupProjection) => { seen.push(projection); return Promise.resolve(membersPayload); } });

test('serves the members collection to a group admin in a governance.v1 envelope carrying the group id', async () => {
  const seen: GroupProjection[] = [];
  const response = await get(transport(groupProjections(seen), [userId]), membersPath);
  const envelope = decodeContract(descriptorFor('governance.v1'), response.body);

  expect(response.status).toBe(200);
  expect(envelope.tenantId).toBeUndefined();
  expect(envelope.payload).toMatchObject({ groupId, collection: 'members', ...membersPayload });
  expect(seen[0]).toMatchObject({ collection: 'members', query: {}, context: { userId, groupId, groupEpoch: 1, adminEpoch: 1 } });
});

const governedReads = () => {
  const calls: string[] = [];
  const window = { runs: 0, completed: 0, failed: 0, unknownOutcome: 0, p95Ms: null, tokens: 0, cost: 0, estimatedRuns: 0 };
  const store = { members: () => Promise.resolve(membersPayload), overview: () => { calls.push('overview'); return Promise.resolve({ workspaces: [{ tenantId, name: 'one', window: 'current' as const, ...window }, { tenantId, name: 'one', window: 'previous' as const, ...window }], totals: [{ window: 'current' as const, ...window }, { window: 'previous' as const, ...window }], pending: [] }); }, runSeries: () => Promise.resolve([]), workflows: () => Promise.resolve([]), pendingApprovals: () => Promise.resolve([]), health: () => Promise.resolve({ connectors: [], circuits: [], reconciliation: [] }) };
  const service = new GovernanceService(store);
  return { calls, options: { groupProjections: (projection: GroupProjection) => service.read(projection.context, projection.collection, projection.query) } };
};

test.each([['approvals', 'approvals'], ['health', 'connectors']])('serves %s to a group admin and refuses a non-admin with 403', async (collection, field) => {
  const { options } = governedReads();
  const ok = await get(transport(options, [userId]), `/api/v1/groups/${groupId}/${collection}`);

  expect(ok.status).toBe(200);
  expect(decodeContract(descriptorFor('governance.v1'), ok.body).payload).toMatchObject({ groupId, collection, classification: 'restricted-operational', [field]: [] });
  expect((await get(transport(options, []), `/api/v1/groups/${groupId}/${collection}`)).status).toBe(403);
});

test('serves the overview to a group admin, refuses a bad range with 422 and a workspace outside the group with 403', async () => {
  const { calls, options } = governedReads();
  const ok = await get(transport(options, [userId]), `/api/v1/groups/${groupId}/overview?range=7d`);

  expect(ok.status).toBe(200);
  expect(decodeContract(descriptorFor('governance.v1'), ok.body).payload).toMatchObject({ groupId, collection: 'overview', range: '7d', classification: 'restricted-operational', workspaces: [{ tenantId, runs: 0 }] });
  expect((await get(transport(options, [userId]), `/api/v1/groups/${groupId}/overview?range=2y`)).status).toBe(422);
  expect((await get(transport(options, [userId]), `/api/v1/groups/${groupId}/overview?range=7d&tenant=66666666-6666-4666-8666-666666666666`)).status).toBe(403);
  expect((await get(transport(options, []), `/api/v1/groups/${groupId}/overview?range=7d`)).status).toBe(403);
  expect(calls).toEqual(['overview']);
});

test.each([
  ['a non-admin of the group', [], membersPath],
  ['a foreign group id', [userId], '/api/v1/groups/66666666-6666-4666-8666-666666666666/members'],
  ['a group id that is not a UUID', [userId], '/api/v1/groups/not-a-uuid/members'],
])('refuses a group read from %s with 403', async (_name, admins, path) => {
  expect((await get(transport(groupProjections(), admins), path)).status).toBe(403);
});

test('refuses a group read without a bearer token with 401', async () => {
  expect((await get(transport(groupProjections(), [userId]), membersPath, { origin })).status).toBe(401);
});

test('answers 404 for an unknown group collection', async () => {
  expect((await get(transport(groupProjections(), [userId]), `/api/v1/groups/${groupId}/nope`)).status).toBe(404);
});

test('answers 501 for a group read when no projection handler is registered', async () => {
  expect((await get(transport({}, [userId]), membersPath)).status).toBe(501);
});

test.each([
  ['an unknown query key', `${membersPath}?colour=red`],
  ['a repeated query key', `${membersPath}?range=1h&range=6h`],
  ['a 201-character value', `${membersPath}?range=${'a'.repeat(201)}`],
  ['an over-long cursor', `${membersPath}?cursor=${'a'.repeat(2001)}`],
  ['a prototype key', `${membersPath}?__proto__=x`],
])('refuses a group read with %s with 422', async (_name, path) => {
  expect((await get(transport(groupProjections(), [userId]), path)).status).toBe(422);
});

test('passes allowed query keys to the group projection handler', async () => {
  const seen: GroupProjection[] = [];
  const response = await get(transport(groupProjections(seen), [userId]), `${membersPath}?range=1h&tenant=${tenantId}&cursor=${'a'.repeat(2000)}`);

  expect(response.status).toBe(200);
  expect(seen[0]?.query).toEqual({ range: '1h', tenant: tenantId, cursor: 'a'.repeat(2000) });
});

function observe() {
  const spans = new InMemorySpanExporter();
  new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] }).register();
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const provider = new MeterProvider({ readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000, exportTimeoutMillis: 30_000 })] });
  metrics.setGlobalMeterProvider(provider);
  const points = async (name: string): Promise<{ attributes: Record<string, unknown>; value: unknown }[]> => { await provider.forceFlush(); return exporter.getMetrics().slice(-1).flatMap((batch) => batch.scopeMetrics.flatMap((scope) => scope.metrics)).filter((metric) => metric.descriptor.name === name).flatMap((metric) => metric.dataPoints as { attributes: Record<string, unknown>; value: unknown }[]); };
  return { spans, points };
}
const events = (name: string): Record<string, unknown>[] => stdout.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>).filter((line) => line['event'] === name);
const randomTenant = '77777777-7777-4777-8777-777777777777';

test('a projection request yields one root span and one duration point labelled with the route template and the verified tenant', async () => {
  const { spans, points } = observe();
  const response = await get(transport(), `/api/v1/tenants/${tenantId}/cases`);

  expect(response.status).toBe(200);
  const finished = spans.getFinishedSpans();
  expect(finished).toHaveLength(1);
  expect(finished[0]?.name).toBe('browser.request');
  expect(finished[0]?.attributes).toMatchObject({ 'http.request.method': 'GET', 'http.route': '/api/v1/tenants/:tenantId/:collection', 'http.response.status_code': 200, tenant_id: tenantId, 'app.correlation_id': response.headers['x-correlation-id'] });
  const duration = await points('http.server.request.duration');
  expect(duration).toHaveLength(1);
  expect(duration[0]?.attributes).toEqual({ 'http.route': '/api/v1/tenants/:tenantId/:collection', 'http.request.method': 'GET', 'http.response.status_code': 200, tenant_id: tenantId });
  expect((duration[0]?.value as { count: number }).count).toBe(1);
});

test('a 403 for a random tenant id records a point without a tenant label and counts auth.denied', async () => {
  const { spans, points } = observe();
  const response = await get(transport(), `/api/v1/tenants/${randomTenant}/cases`);

  expect(response.status).toBe(403);
  const duration = await points('http.server.request.duration');
  expect(duration.map((point) => point.attributes)).toEqual([{ 'http.route': '/api/v1/tenants/:tenantId/:collection', 'http.request.method': 'GET', 'http.response.status_code': 403 }]);
  expect(spans.getFinishedSpans()[0]?.attributes).not.toHaveProperty('tenant_id');
  expect((await points('auth.denied')).map((point) => ({ value: point.value, attributes: point.attributes }))).toEqual([{ value: 1, attributes: { reason: 'DENIED' } }]);
  expect(events('auth.denied')).toEqual([expect.objectContaining({ route: '/api/v1/tenants/:tenantId/:collection', reason: 'DENIED' })]);
});

test('a missing bearer token counts auth.denied with the UNAUTHENTICATED reason', async () => {
  const { points } = observe();
  const response = await get(transport(), '/api/v1/session', { origin });

  expect(response.status).toBe(401);
  expect((await points('auth.denied')).map((point) => point.attributes)).toEqual([{ reason: 'UNAUTHENTICATED' }]);
});

test.each([
  ['an unknown top-level path', '/api/v1/nothing', 404],
  ['a path with a raw user-controlled segment', '/api/v1/tenants/not-a-uuid-at-all/whatever/else', 403],
  ['an unknown tenant sub-route', `/api/v1/tenants/${tenantId}/nothing`, 404],
])('labels %s as unmatched, never with the raw path', async (_name, path, status) => {
  const { points } = observe();
  const response = await get(transport(), path);

  expect(response.status).toBe(status);
  expect((await points('http.server.request.duration')).map((point) => point.attributes['http.route'])).toEqual(['unmatched']);
});

test.each([
  ['/api/v1/session', '/api/v1/session'],
  ['/api/v1/tenants', '/api/v1/tenants'],
  ['/api/v1/groups', '/api/v1/groups'],
  [`/api/v1/groups/${groupId}/members`, '/api/v1/groups/:groupId/:collection'],
  [`/api/v1/tenants/${tenantId}/events`, '/api/v1/tenants/:tenantId/events'],
])('labels %s with the template %s', async (path, template) => {
  const { points } = observe();
  await get(transport(groupProjections(), [userId]), path);

  expect((await points('http.server.request.duration')).map((point) => point.attributes['http.route'])).toEqual([template]);
});

test('labels tenant and group commands and the connection route with their templates', async () => {
  const { points } = observe();
  const tenantHeaders = { ...commandHeaders, 'if-match': '0' };
  const tenantBody = { messageId: correlation, contract: 'browser.v1', contractVersion: '1.0.0', occurredAt: '2026-01-01T00:00:00.000Z', tenantId, correlationId: correlation, sender: 'platform-browser', classification: 'restricted-operational', payload: { expectedVersion: 0, arguments: {} } };
  const browser = transport({ commands: {}, connections: () => Promise.resolve({}), groupCommands: { 'governance.add-tenant': () => Promise.resolve(okReceipt), 'governance.create-group': () => Promise.resolve(okReceipt) } }, [userId]);
  await browser.handle({ method: 'POST', path: `/api/v1/tenants/${tenantId}/commands/workflow/check`, headers: tenantHeaders, body: new TextEncoder().encode(JSON.stringify(tenantBody)) });
  await browser.handle({ method: 'POST', path: `/api/v1/tenants/${tenantId}/openrouter-connection`, headers: { authorization: `Bearer ${userId}`, origin, 'content-type': 'application/json', 'idempotency-key': commandHeaders['idempotency-key'] }, body: new TextEncoder().encode('{"action":"verify","expectedVersion":0}') });
  await postGroup(browser, addTenantPath, commandBody(1, { tenantId: otherTenant }));
  await postGroup(browser, '/api/v1/groups/commands/governance/create-group', commandBody(0, { name: 'Platform', tenantIds: [tenantId], billingTenantId: null }), { ...commandHeaders, 'if-match': '0' });

  const routes = (await points('http.server.request.duration')).map((point) => point.attributes['http.route']).sort();
  expect(routes).toEqual(['/api/v1/groups/:groupId/commands/governance/:name', '/api/v1/groups/commands/governance/create-group', '/api/v1/tenants/:tenantId/commands/:owner/:name', '/api/v1/tenants/:tenantId/openrouter-connection']);
});

test('a tenant command emits command.executed with the outcome, actor and object id', async () => {
  observe();
  const objectId = '88888888-8888-4888-8888-888888888888';
  const body = { messageId: correlation, contract: 'browser.v1', contractVersion: '1.0.0', occurredAt: '2026-01-01T00:00:00.000Z', tenantId, correlationId: correlation, sender: 'platform-browser', classification: 'restricted-operational', payload: { expectedVersion: 0, arguments: { id: objectId } } };
  const browser = transport({ commands: { 'workflow.check': () => Promise.resolve({ objectId, revision: 1 }) } });
  const response = await browser.handle({ method: 'POST', path: `/api/v1/tenants/${tenantId}/commands/workflow/check`, headers: { ...commandHeaders, 'if-match': '0' }, body: new TextEncoder().encode(JSON.stringify(body)) });

  expect(response.status).toBe(200);
  expect(events('command.executed')).toEqual([expect.objectContaining({ tenant_id: tenantId, owner: 'workflow', name: 'check', outcome: 'ok', actor_user_id: userId, object_id: objectId })]);
});

test('MCP credential commands route through the tenant command route while the connection route still resolves', async () => {
  const { points } = observe();
  const objectId = '88888888-8888-4888-8888-888888888888';
  const handler = vi.fn(() => Promise.resolve({ objectId, revision: 1 }));
  const body = { messageId: correlation, contract: 'browser.v1', contractVersion: '1.0.0', occurredAt: '2026-01-01T00:00:00.000Z', tenantId, correlationId: correlation, sender: 'platform-browser', classification: 'restricted-operational', payload: { expectedVersion: 0, arguments: { id: objectId, key: 'pasted-token' } } };
  const browser = transport({ commands: { 'workflow.connect-mcp-credential': handler }, connections: () => Promise.resolve({}) });
  const response = await browser.handle({ method: 'POST', path: `/api/v1/tenants/${tenantId}/commands/workflow/connect-mcp-credential`, headers: { ...commandHeaders, 'if-match': '0' }, body: new TextEncoder().encode(JSON.stringify(body)) });
  const connection = await browser.handle({ method: 'POST', path: `/api/v1/tenants/${tenantId}/openrouter-connection`, headers: { authorization: `Bearer ${userId}`, origin, 'content-type': 'application/json', 'idempotency-key': commandHeaders['idempotency-key'] }, body: new TextEncoder().encode('{"action":"verify","expectedVersion":0}') });

  expect(response.status).toBe(200);
  expect(connection.status).toBe(200);
  expect(handler).toHaveBeenCalledWith(expect.objectContaining({ owner: 'workflow', name: 'connect-mcp-credential', arguments: { id: objectId, key: 'pasted-token' } }));
  expect(new TextDecoder().decode(response.body)).not.toContain('pasted-token');
  expect((await points('http.server.request.duration')).map((point) => point.attributes['http.route']).sort()).toEqual(['/api/v1/tenants/:tenantId/commands/:owner/:name', '/api/v1/tenants/:tenantId/openrouter-connection']);
});

test('a failing tenant command emits command.executed with the error code', async () => {
  observe();
  const body = { messageId: correlation, contract: 'browser.v1', contractVersion: '1.0.0', occurredAt: '2026-01-01T00:00:00.000Z', tenantId, correlationId: correlation, sender: 'platform-browser', classification: 'restricted-operational', payload: { expectedVersion: 0, arguments: { id: '88888888-8888-4888-8888-888888888888' } } };
  const browser = transport({ commands: { 'workflow.check': () => Promise.reject(Object.assign(new Error('CONFLICT'), { code: 'CONFLICT' })) } });
  const response = await browser.handle({ method: 'POST', path: `/api/v1/tenants/${tenantId}/commands/workflow/check`, headers: { ...commandHeaders, 'if-match': '0' }, body: new TextEncoder().encode(JSON.stringify(body)) });

  expect(response.status).toBe(409);
  expect(events('command.executed')).toEqual([expect.objectContaining({ owner: 'workflow', name: 'check', outcome: 'CONFLICT', actor_user_id: userId })]);
});

test('a group command emits command.executed and group.changed', async () => {
  observe();
  const browser = transport({ groupCommands: { 'governance.add-tenant': () => Promise.resolve(okReceipt) } }, [userId]);
  const response = await postGroup(browser, addTenantPath, commandBody(1, { tenantId: otherTenant }));

  expect(response.status).toBe(200);
  expect(events('command.executed')).toEqual([expect.objectContaining({ owner: 'governance', name: 'add-tenant', outcome: 'ok', actor_user_id: userId, object_id: groupId })]);
  expect(events('group.changed')).toEqual([expect.objectContaining({ group_id: groupId, action: 'add-tenant', actor_user_id: userId, subject_id: otherTenant })]);
});

test('a refused group command emits command.executed with the error code and no group.changed', async () => {
  observe();
  const browser = transport({ groupCommands: { 'governance.add-tenant': () => Promise.reject(Object.assign(new Error('STALE'), { code: 'STALE' })) } }, [userId]);
  const response = await postGroup(browser, addTenantPath, commandBody(1, { tenantId: otherTenant }));

  expect(response.status).toBe(409);
  expect(events('command.executed')).toEqual([expect.objectContaining({ name: 'add-tenant', outcome: 'STALE' })]);
  expect(events('group.changed')).toEqual([]);
});

test('passes tenantVerified to onError only after the tenant authenticated', async () => {
  const seen: { tenantId?: string; tenantVerified?: boolean }[] = [];
  const browser = transport({ onError: (_error, errorContext) => seen.push(errorContext), commands: { 'workflow.check': () => Promise.reject(new Error('boom')) } });
  await get(browser, `/api/v1/tenants/${randomTenant}/cases`);
  await get(browser, `/api/v1/tenants/${tenantId}/cases?pageSize=500`);
  await get(browser, `/api/v1/tenants/${tenantId}/nothing`);
  const body = { messageId: correlation, contract: 'browser.v1', contractVersion: '1.0.0', occurredAt: '2026-01-01T00:00:00.000Z', tenantId, correlationId: correlation, sender: 'platform-browser', classification: 'restricted-operational', payload: { expectedVersion: 0, arguments: { id: '88888888-8888-4888-8888-888888888888' } } };
  await browser.handle({ method: 'POST', path: `/api/v1/tenants/${tenantId}/commands/workflow/check`, headers: { ...commandHeaders, 'if-match': '0' }, body: new TextEncoder().encode(JSON.stringify(body)) });

  expect(seen.map((item) => item.tenantVerified)).toEqual([undefined, undefined, undefined, true]);
  expect(seen.map((item) => item.tenantId)).toEqual([randomTenant, tenantId, tenantId, tenantId]);
});
