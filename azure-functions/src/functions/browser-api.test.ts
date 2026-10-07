import type { InvocationContext } from '@azure/functions';
import { afterEach, expect, test, vi } from 'vitest';
import { browserApi } from './browser-api.js';

const claimed = new Set<string>();
vi.mock('./demo-claim.js', () => ({
  durableDemoClaims: () => ({
    claimed: async (key: string) => claimed.has(key),
    claim: async (key: string) => { if (claimed.has(key)) return false; claimed.add(key); return true; },
  }),
}));

afterEach(() => { vi.unstubAllEnvs(); claimed.clear(); });

const WEB = 'https://platform.example.com';
const demoRequest = (forwardedFor: string, origin = WEB, body = '{}') => new Request('https://api.example.com/api/v1/demo/run', { method: 'POST', headers: { origin, 'x-forwarded-for': forwardedFor, 'content-type': 'application/json' }, body });
const context = {} as InvocationContext;

test('only grants CORS preflight to the configured Vercel origin', async () => {
  vi.stubEnv('CLERK_AUTHORIZED_PARTIES', 'https://platform.example.com');
  const accepted = await browserApi(new Request('https://api.example.com/api/v1/tenants', { method: 'OPTIONS', headers: { origin: 'https://platform.example.com' } }));
  const denied = await browserApi(new Request('https://api.example.com/api/v1/tenants', { method: 'OPTIONS', headers: { origin: 'https://foreign.example' } }));
  expect(accepted).toMatchObject({ status: 204, headers: { 'access-control-allow-origin': 'https://platform.example.com' } });
  expect(denied).toMatchObject({ status: 403 });
});

test('the demo run is anonymous, allowed for the web origin and limited to one per address', async () => {
  vi.stubEnv('CLERK_AUTHORIZED_PARTIES', WEB);
  const first = await browserApi(demoRequest('6.6.6.6, 203.0.113.9'), context);
  expect(first).toMatchObject({ status: 200, headers: { 'access-control-allow-origin': WEB, 'cache-control': 'no-store' } });
  expect(JSON.parse((first as { body: string }).body)).toMatchObject({ run: { source: 'sample', outcome: 'awaiting-approval' } });
  const again = await browserApi(demoRequest('1.1.1.1, 203.0.113.9'), context);
  expect(again).toMatchObject({ status: 429 });
  expect(JSON.parse((again as { body: string }).body)).toMatchObject({ error: { code: 'DEMO_RUN_USED' } });
});

test('a demo request without a trustworthy address is refused', async () => {
  vi.stubEnv('CLERK_AUTHORIZED_PARTIES', WEB);
  expect(await browserApi(new Request('https://api.example.com/api/v1/demo/run', { method: 'POST', headers: { origin: WEB }, body: '{}' }), context)).toMatchObject({ status: 503 });
});

test('an oversized demo body is refused before it is read', async () => {
  vi.stubEnv('CLERK_AUTHORIZED_PARTIES', WEB);
  const reply = await browserApi(new Request('https://api.example.com/api/v1/demo/run', { method: 'POST', headers: { origin: WEB, 'content-length': '999999', 'x-forwarded-for': '203.0.113.9' }, body: '{}' }), context);
  expect(reply).toMatchObject({ status: 413 });
});

const demoGet = (path: string, forwardedFor = '203.0.113.9', origin = WEB) => new Request(`https://api.example.com/api/v1/demo/${path}`, { method: 'GET', headers: { origin, 'x-forwarded-for': forwardedFor } });
const bodyOf = (reply: unknown): unknown => JSON.parse((reply as { body: string }).body);

test('the demo reads are anonymous and unavailable without a database', async () => {
  vi.stubEnv('CLERK_AUTHORIZED_PARTIES', WEB);
  const reply = await browserApi(demoGet('run'), context);
  expect(reply).toMatchObject({ status: 503, headers: { 'access-control-allow-origin': WEB, 'cache-control': 'no-store' } });
  expect(bodyOf(reply)).toMatchObject({ error: { code: 'DEMO_UNAVAILABLE' } });
});

test('the demo reads reject unknown parameters before touching any backend', async () => {
  vi.stubEnv('CLERK_AUTHORIZED_PARTIES', WEB);
  vi.stubEnv('AZURE_SQL_CONNECTION_STRING', 'Server=unreachable.invalid;Database=x');
  const reply = await browserApi(demoGet('governance/overview?range=24h&tenant=a1000000-0000-4000-8000-000000000001'), context);
  expect(reply).toMatchObject({ status: 400 });
  expect(bodyOf(reply)).toMatchObject({ error: { code: 'INVALID_INPUT' } });
});

test('the demo reads are limited per address', async () => {
  vi.stubEnv('CLERK_AUTHORIZED_PARTIES', WEB);
  vi.stubEnv('AZURE_SQL_CONNECTION_STRING', 'Server=unreachable.invalid;Database=x');
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 62; attempt += 1) statuses.push(((await browserApi(demoGet('governance/overview?x=1', '203.0.113.77'), context)) as { status: number }).status);
  expect(statuses.slice(0, 60).every((status) => status === 400)).toBe(true);
  expect(statuses.slice(60)).toEqual([429, 429]);
});

test('other demo paths still go to the authenticated API', async () => {
  vi.stubEnv('CLERK_AUTHORIZED_PARTIES', WEB);
  const reply = await browserApi(demoGet('governance/members'), context);
  expect((reply as { status: number }).status).not.toBe(200);
});
