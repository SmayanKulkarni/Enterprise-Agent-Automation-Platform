import { expect, test, vi } from 'vitest';

const rows = vi.hoisted(() => ({ list: [] as Record<string, unknown>[], session: [] as Record<string, unknown>[] }));
vi.mock('mssql', () => ({ default: {
  UniqueIdentifier: 'uuid',
  NVarChar: () => 'nvarchar',
  ConnectionPool: class {
    async connect() { return this; }
    request() { return { input() { return this; }, async execute(procedure: string) { return { recordset: procedure === 'identity.list_current_tenants' ? rows.list : rows.session }; } }; }
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
