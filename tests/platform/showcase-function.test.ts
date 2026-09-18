import { describe, expect, test } from 'vitest';
import { browserResponse } from '../../packages/browser/src/browser-response.js';

const tenant = '22222222-2222-4222-8222-222222222222';
const origin = 'https://showcase.example';
const environment = { CLERK_ISSUER: 'https://clerk.example', CLERK_PUBLISHABLE_KEY: 'pk_test', CLERK_SECRET_KEY: 'sk_test', CLERK_AUDIENCE: 'platform-browser-api', CLERK_AUTHORIZED_PARTIES: origin, PLATFORM_LOCAL_CLERK_SUBJECT: 'user-1', PLATFORM_LOCAL_TENANTS: tenant };
const backend = { verifyToken: () => Promise.resolve({ iss: environment.CLERK_ISSUER, sub: 'user-1', sid: 'session-1', azp: origin, exp: 4_102_444_800 }), sessions: { getSession: () => Promise.resolve({ userId: 'user-1', status: 'active' }) } };
const request = (requestOrigin?: string, url = `${origin}/api/v1/tenants`) => new Request(url, { headers: { authorization: 'Bearer fixture-token', ...(requestOrigin === undefined ? {} : { origin: requestOrigin }) } });

describe('showcase Vercel bridge', () => {
  test('serves the tenant through the existing transport and denies a foreign origin', async () => {
    const accepted = await browserResponse(request(origin), environment, backend);
    expect(accepted.status).toBe(200);
    expect(await accepted.text()).toContain(tenant);
    expect((await browserResponse(request(), environment, backend)).status).toBe(200);
    const denied = await browserResponse(request('https://foreign.example'), environment, backend);
    expect([400, 401, 403]).toContain(denied.status);
    expect(await denied.text()).not.toContain(tenant);
    expect((await browserResponse(request(undefined, `${origin}/api/v1/tenants/${tenant}/cases?pageSize=0`), environment, backend)).status).toBe(400);
  });
});
