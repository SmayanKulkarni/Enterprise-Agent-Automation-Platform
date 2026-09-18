import { afterEach, expect, test, vi } from 'vitest';
import { browserApi } from './browser-api.js';

afterEach(() => vi.unstubAllEnvs());

test('only grants CORS preflight to the configured Vercel origin', async () => {
  vi.stubEnv('CLERK_AUTHORIZED_PARTIES', 'https://platform.example.com');
  const accepted = await browserApi(new Request('https://api.example.com/api/v1/tenants', { method: 'OPTIONS', headers: { origin: 'https://platform.example.com' } }));
  const denied = await browserApi(new Request('https://api.example.com/api/v1/tenants', { method: 'OPTIONS', headers: { origin: 'https://foreign.example' } }));
  expect(accepted).toMatchObject({ status: 204, headers: { 'access-control-allow-origin': 'https://platform.example.com' } });
  expect(denied).toMatchObject({ status: 403 });
});
