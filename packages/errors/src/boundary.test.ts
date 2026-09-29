import { afterEach, expect, test, vi } from 'vitest';
import { AppError } from './app-error.js';
import { withErrorBoundary } from './boundary.js';

afterEach(() => vi.restoreAllMocks());

const correlation = '11111111-1111-4111-8111-111111111111';

test('returns the safe envelope and correlation header, logging exactly once without secrets', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const handler = withErrorBoundary(() => Promise.reject(new Error('db down Bearer sekret-token')));
  const response = await handler(new Request('https://x.test/api/workflow-webhook/t/d?token=q', { method: 'POST', headers: { authorization: 'Bearer sekret-token', 'x-correlation-id': correlation }, body: 'payload-body' }));

  expect(response).toMatchObject({ status: 500, headers: { 'x-correlation-id': correlation }, jsonBody: { error: { category: 'terminal', code: 'INTERNAL', redacted: true } } });
  expect(error).toHaveBeenCalledTimes(1);
  const line = String(error.mock.calls[0]?.[0]);
  expect(line).toContain(correlation);
  expect(line).not.toContain('sekret-token');
  expect(line).not.toContain('payload-body');
  expect(line).not.toContain('token=q');
});

test('maps a thrown AppError to its status at warn level', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const response = await withErrorBoundary(() => Promise.reject(new AppError('NOT_FOUND')))(new Request('https://x.test/a'));

  expect(response).toMatchObject({ status: 404, jsonBody: { error: { code: 'NOT_FOUND' } } });
  expect(warn).toHaveBeenCalledTimes(1);
});

test('wraps browser routes in the browser.v1 envelope', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const response = await withErrorBoundary(() => Promise.reject(new AppError('DENIED')))(new Request('https://x.test/api/v1/session', { headers: { 'x-correlation-id': correlation } }));

  expect(response).toMatchObject({ status: 403, jsonBody: { contract: 'browser.v1', correlationId: correlation, payload: { error: { code: 'DENIED' } } } });
});

test('generates a correlation id and merges extra headers', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const response = await withErrorBoundary(() => Promise.reject(new Error('x')), { headers: () => ({ vary: 'Origin' }) })(new Request('https://x.test/a'));

  expect(response.headers['vary']).toBe('Origin');
  expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/u);
});

test('passes through a successful result untouched', async () => {
  expect(await withErrorBoundary(() => Promise.resolve({ status: 204 }))(new Request('https://x.test/a'))).toEqual({ status: 204 });
});

test('fetch mode returns a Response', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const response = await withErrorBoundary(() => Promise.reject(new Error('x')), { kind: 'fetch' })(new Request('https://x.test/api/v1/session'));

  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(500);
  expect(response.headers.get('x-correlation-id')).toMatch(/^[0-9a-f-]{36}$/u);
});
