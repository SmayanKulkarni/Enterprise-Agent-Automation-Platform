import { afterEach, describe, expect, test, vi } from 'vitest';
import { PlatformApi, PlatformApiError, describeError, errorRef, lastCorrelationId, withRef } from './platform-api.js';

afterEach(() => vi.unstubAllGlobals());

describe('PlatformApi', () => {
  test('sends a Clerk bearer session token and parses safe Tenant projections', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ payload: { tenant: { id: '11111111-1111-4111-8111-111111111111', epoch: 1 }, actionHints: [], completeness: 'full' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await expect(new PlatformApi(() => Promise.resolve('short-lived')).session()).resolves.toEqual({ tenantId: '11111111-1111-4111-8111-111111111111', actionHints: [] });
    expect(fetch).toHaveBeenCalledWith('/api/v1/session', { headers: expect.objectContaining({ accept: 'application/vnd.platform.browser.v1+json', authorization: 'Bearer short-lived', 'x-correlation-id': expect.any(String) }) });
  });

  test('preserves the safe denial category and rejects malformed payloads', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ payload: { error: { category: 'denied' } } }), { status: 400 })).mockResolvedValueOnce(new Response(JSON.stringify({ payload: { tenants: [null], completeness: 'full' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const api = new PlatformApi(() => Promise.resolve('short-lived'));

    await expect(api.session()).rejects.toMatchObject({ status: 400, category: 'denied' });
    await expect(api.tenants()).rejects.toBeInstanceOf(PlatformApiError);
  });

  test('loads an opaque projection detail through the authorized Tenant route', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ payload: { tenantId: '11111111-1111-4111-8111-111111111111', collection: 'cases', records: [], completeness: 'full', classification: 'restricted-operational', freshness: 'current', redaction: 'none' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await expect(new PlatformApi(() => Promise.resolve('short-lived')).projection('11111111-1111-4111-8111-111111111111', 'cases', '22222222-2222-4222-8222-222222222222')).resolves.toMatchObject({ collection: 'cases' });
    expect(fetch).toHaveBeenCalledWith('/api/v1/tenants/11111111-1111-4111-8111-111111111111/cases/22222222-2222-4222-8222-222222222222', { headers: expect.objectContaining({ accept: 'application/vnd.platform.browser.v1+json', authorization: 'Bearer short-lived', 'x-platform-tenant': '11111111-1111-4111-8111-111111111111', 'x-correlation-id': expect.any(String) }) });
  });

  test('uses the configured external API origin', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ payload: { tenants: [], completeness: 'full' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await expect(new PlatformApi(() => Promise.resolve('short-lived'), 'https://api.example.com').tenants()).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledWith('https://api.example.com/api/v1/tenants', { headers: expect.objectContaining({ accept: 'application/vnd.platform.browser.v1+json', authorization: 'Bearer short-lived', 'x-correlation-id': expect.any(String) }) });
  });

  test('sends an exact, retry-safe browser.v1 command envelope', async () => {
    const receipt = () => new Response(JSON.stringify({ payload: { commandId: '33333333-3333-4333-8333-333333333333', objectId: '22222222-2222-4222-8222-222222222222', revision: 3, state: 'draft', digest: 'a'.repeat(64), evidenceIds: [] } }), { status: 200 });
    const fetch = vi.fn().mockImplementation(receipt);
    vi.stubGlobal('fetch', fetch);
    const api = new PlatformApi(() => Promise.resolve('short-lived'));
    const command = { tenantId: '11111111-1111-4111-8111-111111111111', owner: 'studio', name: 'save-draft', expectedVersion: 2, arguments: { id: '22222222-2222-4222-8222-222222222222', draft: {} } };

    await expect(api.command(command)).resolves.toMatchObject({ revision: 3, state: 'draft' });
    await api.command(command);
    const first = fetch.mock.calls[0]?.[1] as RequestInit;
    const second = fetch.mock.calls[1]?.[1] as RequestInit;
    expect(first.method).toBe('POST');
    expect(first.headers).toMatchObject({ accept: 'application/vnd.platform.browser.v1+json', 'content-type': 'application/vnd.platform.browser.v1+json', 'if-match': '2', 'x-platform-tenant': command.tenantId, authorization: 'Bearer short-lived' });
    expect((first.headers as Record<string, string>)['idempotency-key']).toBe((second.headers as Record<string, string>)['idempotency-key']);
    expect(JSON.parse(first.body as string)).toMatchObject({ contract: 'browser.v1', tenantId: command.tenantId, payload: { expectedVersion: 2, arguments: command.arguments } });
  });

  test('rejects unsupported commands before a browser request is made', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(new PlatformApi(() => Promise.resolve('short-lived')).command({ tenantId: '11111111-1111-4111-8111-111111111111', owner: 'vendor', name: 'publish', expectedVersion: 0, arguments: {} })).rejects.toMatchObject({ status: 400, category: 'invalid' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('error responses', () => {
  const correlationId = 'abcdef12-0000-4000-8000-000000000000';

  test('an empty 404 body becomes a PlatformApiError, never a SyntaxError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404, headers: { 'x-correlation-id': correlationId } })));

    await expect(new PlatformApi(() => Promise.resolve('t')).session()).rejects.toMatchObject({ name: 'Error', status: 404, correlationId });
  });

  test('a non-JSON error body still yields the status and the sent correlation id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 })));

    const error = await new PlatformApi(() => Promise.resolve('t')).tenants().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PlatformApiError);
    expect(error).toMatchObject({ status: 502, correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/u) });
  });

  test('surfaces the server code, category and correlation id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ payload: { error: { category: 'conflict', code: 'STALE', message: 'x' } } }), { status: 409, headers: { 'x-correlation-id': correlationId } })));

    const error = await new PlatformApi(() => Promise.resolve('t')).tenants().catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 409, category: 'conflict', code: 'STALE', correlationId });
    expect(lastCorrelationId()).toBe(correlationId);
    expect(errorRef(error)).toBe('abcdef12');
    expect(withRef('Save failed.', error)).toBe('Save failed. Ref: abcdef12');
  });

  test('withRef leaves messages alone when there is no correlation id', () => {
    expect(withRef('Save failed.', new Error('x'))).toBe('Save failed.');
  });

  test('an empty success body is a PlatformApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    await expect(new PlatformApi(() => Promise.resolve('t')).tenants()).rejects.toBeInstanceOf(PlatformApiError);
  });
});

describe('describeError', () => {
  test('prefers the server category over the HTTP status', () => {
    expect(describeError(new PlatformApiError(500, 'denied'))).toBe('denied');
    expect(describeError(new PlatformApiError(500, 'invalid'))).toBe('invalid');
    expect(describeError(new PlatformApiError(500, 'conflict'))).toBe('conflict');
    expect(describeError(new PlatformApiError(500, 'unknown-outcome'))).toBe('unknown');
    expect(describeError(new PlatformApiError(200, 'retryable'))).toBe('unavailable');
    expect(describeError(new PlatformApiError(200, 'timeout'))).toBe('unavailable');
    expect(describeError(new PlatformApiError(200, 'terminal'))).toBe('unavailable');
  });

  test('falls back to HTTP status when no known category is present', () => {
    expect(describeError(new PlatformApiError(401, 'denied'))).toBe('signed-out');
    expect(describeError(new PlatformApiError(404, 'invalid'))).toBe('not-found');
    expect(describeError(new PlatformApiError(401))).toBe('signed-out');
    expect(describeError(new PlatformApiError(403))).toBe('denied');
    expect(describeError(new PlatformApiError(404))).toBe('not-found');
    expect(describeError(new PlatformApiError(409))).toBe('conflict');
    expect(describeError(new PlatformApiError(412))).toBe('conflict');
    expect(describeError(new PlatformApiError(400))).toBe('invalid');
    expect(describeError(new PlatformApiError(422))).toBe('invalid');
    expect(describeError(new PlatformApiError(429))).toBe('rate-limited');
    expect(describeError(new PlatformApiError(502))).toBe('unavailable');
  });

  test('treats a non-JSON body and a dropped connection as unavailable, or unknown for a write', () => {
    expect(describeError(new SyntaxError('Unexpected token'))).toBe('unavailable');
    expect(describeError(new TypeError('Failed to fetch'))).toBe('unavailable');
    expect(describeError(new SyntaxError('Unexpected token'), { write: true })).toBe('unknown');
    expect(describeError(new TypeError('Failed to fetch'), { write: true })).toBe('unknown');
  });
});
