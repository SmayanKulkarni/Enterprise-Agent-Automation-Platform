import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

test('defaults to same-origin when no API origin is configured', async () => {
  vi.stubEnv('VITE_PLATFORM_API_ORIGIN', '');
  expect((await import('./api-origin.js')).apiOrigin).toBe('');
});

test('strips trailing slashes from the configured API origin', async () => {
  vi.stubEnv('VITE_PLATFORM_API_ORIGIN', ' https://func-eaa-prod.azurewebsites.net// ');
  expect((await import('./api-origin.js')).apiOrigin).toBe('https://func-eaa-prod.azurewebsites.net');
});

test('both API clients default to the configured origin', async () => {
  vi.stubEnv('VITE_PLATFORM_API_ORIGIN', 'https://api.example');
  const { PlatformApi } = await import('./platform-api.js');
  expect(new PlatformApi(() => Promise.resolve(null)).publicOrigin).toBe('https://api.example');
});
