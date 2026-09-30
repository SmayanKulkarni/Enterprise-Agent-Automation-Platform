import { expect, test } from 'vitest';
import { correlationId } from '../../contracts/src/index.js';
import { governanceCommandHandlers } from './governance-commands.js';
import type { GroupCommand } from './index.js';

const groupId = 'a0000000-0000-4000-8000-000000000001';
const tenantId = '11111111-1111-4111-8111-111111111111';
const key = '33333333-3333-4333-8333-333333333333';
const base = { userId: 'user-1', idempotencyKey: key, correlationId: correlationId('44444444-4444-4444-8444-444444444444'), digest: 'd'.repeat(64) } as const;
const group = { userId: 'user-1', groupId, groupEpoch: 4, adminEpoch: 2, tenantIds: [] };

const echoStore = () => {
  const calls: unknown[][] = [];
  return { calls, store: {
    createGroup: (...input: unknown[]) => { calls.push(input); return Promise.resolve({ receipt: input[4] as Record<string, unknown>, replayed: false }); },
    command: (...input: unknown[]) => { calls.push(input); return Promise.resolve({ receipt: input[6] as Record<string, unknown>, replayed: false }); },
  } };
};

test('builds a receipt with revision one above the expected version for add-tenant', async () => {
  const { store, calls } = echoStore();
  const command: GroupCommand = { ...base, name: 'add-tenant', group, expectedVersion: 4, arguments: { tenantId } };
  const receipt = await governanceCommandHandlers(store)['governance.add-tenant']?.(command);

  expect(receipt).toEqual({ commandId: key, objectId: groupId, revision: 5, state: 'tenant-added', digest: base.digest, evidenceIds: [] });
  expect(calls[0]?.slice(0, 3)).toEqual(['add-tenant', group, 4]);
});

test('uses the idempotency key as the group id when creating a group', async () => {
  const { store, calls } = echoStore();
  const args = { name: 'Platform', tenantIds: [tenantId], billingTenantId: null };
  const receipt = await governanceCommandHandlers(store)['governance.create-group']?.({ ...base, name: 'create-group', expectedVersion: 0, arguments: args });

  expect(receipt).toMatchObject({ objectId: key, revision: 1, state: 'active' });
  expect(calls[0]?.slice(0, 2)).toEqual(['user-1', args]);
});

test('propagates a STALE store error', async () => {
  const store = { createGroup: () => Promise.reject(Object.assign(new Error('STALE'), { code: 'STALE' })), command: () => Promise.reject(Object.assign(new Error('STALE'), { code: 'STALE' })) };

  await expect(governanceCommandHandlers(store as never)['governance.remove-tenant']?.({ ...base, name: 'remove-tenant', group, expectedVersion: 1, arguments: { tenantId } })).rejects.toMatchObject({ code: 'STALE' });
});

test('denies a tenant command that carries no group session', async () => {
  const { store } = echoStore();

  await expect(governanceCommandHandlers(store as never)['governance.add-tenant']?.({ ...base, name: 'add-tenant', expectedVersion: 1, arguments: { tenantId } })).rejects.toMatchObject({ code: 'DENIED' });
});
