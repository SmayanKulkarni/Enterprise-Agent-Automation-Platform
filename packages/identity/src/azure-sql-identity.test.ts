import { expect, test, vi } from 'vitest';

const rows = vi.hoisted(() => ({ list: [] as Record<string, unknown>[], session: [] as Record<string, unknown>[], connections: 0, failures: 0 }));
vi.mock('mssql', () => ({ default: {
  UniqueIdentifier: 'uuid',
  NVarChar: () => 'nvarchar',
  ConnectionPool: class {
    constructor() { rows.connections += 1; }
    connect() { if (rows.failures > 0) { rows.failures -= 1; return Promise.reject(new Error('connect failed')); } return Promise.resolve(this); }
    on() { return this; }
    request() { return { input() { return this; }, execute(procedure: string) { return Promise.resolve({ recordset: procedure === 'identity.list_current_tenants' ? rows.list : rows.session }); } }; }
    async close() {}
  },
} }));

import { AzureSqlIdentityStore, type Proof } from './index.js';

test('accepts Azure SQL BIGINT epochs returned as decimal strings', async () => {
  const tenant = '22222222-2222-4222-8222-222222222222';
  rows.list = [{ tenant_id: tenant, membership_epoch: '2', profile_key: 'admin' }];
  rows.session = [{ user_id: 'user-1', tenant_epoch: '3', membership_epoch: '2' }];
  const proof: Proof = { mode: 'interactive', issuer: 'https://issuer.example', subject: 'user-1', audience: 'platform-browser-api', expiresAt: '2099-01-01T00:00:00.000Z', tokenUse: 'session', sessionId: 'session-1' };
  const identity = new AzureSqlIdentityStore('configured');
  expect(await identity.membershipsForProof(proof)).toEqual([{ tenantId: tenant, profiles: ['admin'], epoch: 2 }]);
  expect(await identity.authenticate(proof, tenant, 'platform-browser-api')).toMatchObject({ userId: 'user-1', tenantEpoch: 3, membershipEpoch: 2 });
});

test('reuses one concurrent pool and retries after a rejected connection', async () => {
  const tenant = '33333333-3333-4333-8333-333333333333';
  const proof: Proof = { mode: 'interactive', issuer: 'https://issuer.example', subject: 'user-1', audience: 'platform-browser-api', expiresAt: '2099-01-01T00:00:00.000Z', tokenUse: 'session', sessionId: 'session-1' };
  rows.session = [{ user_id: 'user-1', tenant_epoch: '3', membership_epoch: '2' }];
  const before = rows.connections;
  const first = new AzureSqlIdentityStore('pool-test'); const second = new AzureSqlIdentityStore('pool-test');
  await Promise.all([first.authenticate(proof, tenant, 'platform-browser-api'), second.authenticate(proof, tenant, 'platform-browser-api')]);
  expect(rows.connections - before).toBe(1);
  rows.failures = 1;
  await expect(new AzureSqlIdentityStore('retry-test').authenticate(proof, tenant, 'platform-browser-api')).rejects.toThrow('connect failed');
  await expect(new AzureSqlIdentityStore('retry-test').authenticate(proof, tenant, 'platform-browser-api')).resolves.toMatchObject({ userId: 'user-1' });
});
