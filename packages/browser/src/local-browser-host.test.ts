import { expect, test } from 'vitest';
import { localBrowserTransport } from './local-browser-host.js';

test('uses Azure SQL without local fixture settings', () => {
  expect(() => localBrowserTransport({
    AZURE_SQL_CONNECTION_STRING: 'Server=example.database.windows.net;Database=platform;User Id=platform_identity_app;Password=test;',
    CLERK_AUDIENCE: 'platform-browser-api',
    CLERK_AUTHORIZED_PARTIES: 'https://platform.example.com',
    CLERK_ISSUER: 'https://example.clerk.accounts.dev',
    CLERK_PUBLISHABLE_KEY: 'pk_test_example',
    CLERK_SECRET_KEY: 'sk_test_example',
  }, { verifyToken: async () => undefined, sessions: { getSession: async () => ({ userId: '', status: 'ended' }) } })).not.toThrow();
});
