import { afterEach, describe, expect, test, vi } from 'vitest';
import { PlatformApi, PlatformApiError } from './platform-api.js';

afterEach(() => vi.unstubAllGlobals());

describe('PlatformApi', () => {
  test('sends a Clerk bearer session token and parses safe Tenant projections', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ payload: { tenant: { id: '11111111-1111-4111-8111-111111111111' } } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await expect(new PlatformApi(() => Promise.resolve('short-lived')).session()).resolves.toEqual({ tenantId: '11111111-1111-4111-8111-111111111111' });
    expect(fetch).toHaveBeenCalledWith('/api/v1/session', { headers: { accept: 'application/vnd.platform.browser.v1+json', authorization: 'Bearer short-lived' } });
  });

  test('preserves the safe denial category and rejects malformed payloads', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ payload: { error: { category: 'denied' } } }), { status: 400 })).mockResolvedValueOnce(new Response(JSON.stringify({ payload: { tenants: [null] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const api = new PlatformApi(() => Promise.resolve('short-lived'));

    await expect(api.session()).rejects.toMatchObject({ status: 400, category: 'denied' });
    await expect(api.tenants()).rejects.toBeInstanceOf(PlatformApiError);
  });

  test('loads an opaque projection detail through the authorized Tenant route', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ payload: { collection: 'cases', records: [], completeness: 'full', classification: 'restricted-operational', freshness: 'current', redaction: 'none' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await expect(new PlatformApi(() => Promise.resolve('short-lived')).projection('11111111-1111-4111-8111-111111111111', 'cases', '22222222-2222-4222-8222-222222222222')).resolves.toMatchObject({ collection: 'cases' });
    expect(fetch).toHaveBeenCalledWith('/api/v1/tenants/11111111-1111-4111-8111-111111111111/cases/22222222-2222-4222-8222-222222222222', { headers: { accept: 'application/vnd.platform.browser.v1+json', authorization: 'Bearer short-lived', 'x-platform-tenant': '11111111-1111-4111-8111-111111111111' } });
  });

  test('uses the configured external API origin', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ payload: { tenants: [] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await expect(new PlatformApi(() => Promise.resolve('short-lived'), 'https://api.example.com').tenants()).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledWith('https://api.example.com/api/v1/tenants', { headers: { accept: 'application/vnd.platform.browser.v1+json', authorization: 'Bearer short-lived' } });
  });
});
