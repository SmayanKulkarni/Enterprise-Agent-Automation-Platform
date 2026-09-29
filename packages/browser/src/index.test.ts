import { Buffer } from 'node:buffer';
import { expect, test } from 'vitest';
import { BROWSER_COLLECTIONS } from './browser-contracts.js';
import { BrowserV1Transport, ClerkSessionAdapter, type BrowserTransportOptions } from './index.js';
import { IdentityStore } from '../../identity/src/index.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const origin = 'https://app.example';

function transport(extra: Partial<BrowserTransportOptions> = {}): BrowserV1Transport {
  const identity = new IdentityStore();
  identity.provision(tenantId);
  identity.transition(tenantId, 1, 'activate');
  identity.mapUser('https://clerk.example', userId, userId);
  identity.membership(tenantId, userId, ['admin']);
  identity.setMembership(tenantId, userId, 1, 'current');
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
  ['a foreign cursor', `/api/v1/tenants/${tenantId}/cases?cursor=${Buffer.from('other.1').toString('base64url')}`, { authorization: `Bearer ${userId}`, origin }, 403, 'TENANT_MISMATCH', 'denied'],
  ['a bad page size', `/api/v1/tenants/${tenantId}/cases?pageSize=500`, { authorization: `Bearer ${userId}`, origin }, 422, 'INVALID_PAGE_SIZE', 'invalid'],
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
