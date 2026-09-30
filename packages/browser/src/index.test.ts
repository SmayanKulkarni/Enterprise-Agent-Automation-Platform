import { Buffer } from 'node:buffer';
import { expect, test } from 'vitest';
import { BROWSER_COLLECTIONS } from './browser-contracts.js';
import { BrowserV1Transport, ClerkSessionAdapter, liveClerkSessionAdapter, type BrowserTransportOptions, type ClerkBackend, type GroupCommand } from './index.js';
import { decodeContract, descriptorFor } from '../../contracts/src/index.js';
import { IdentityStore } from '../../identity/src/index.js';

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
