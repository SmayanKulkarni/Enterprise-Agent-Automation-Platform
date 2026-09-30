import { expect, test } from 'vitest';
import { GovernanceService } from './service.js';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const context = { userId: '33333333-3333-4333-8333-333333333333', groupId: 'a0000000-0000-4000-8000-000000000001', groupEpoch: 1, adminEpoch: 1, tenantIds: [tenantA, tenantB] as never };
const members = { workspaces: [{ tenantId: tenantA, name: 'one', joinedAt: '2026-01-01T00:00:00.000Z', billing: true }], admins: [{ userId: context.userId, name: 'Ada' }], eligible: [] };

test('returns the store data labelled full and restricted-operational', async () => {
  const seen: unknown[] = [];
  const service = new GovernanceService({ members: (input) => { seen.push(input); return Promise.resolve(members); } });

  expect(await service.read(context, 'members', {})).toEqual({ ...members, completeness: 'full', classification: 'restricted-operational' });
  expect(seen).toEqual([context]);
});

test('returns fixture data for exactly the context workspaces when no store is configured', async () => {
  const result = await new GovernanceService().read(context, 'members', {});

  expect(result['classification']).toBe('fixture');
  expect((result['workspaces'] as { tenantId: string }[]).map((workspace) => workspace.tenantId)).toEqual([tenantA, tenantB]);
  expect((result['admins'] as { userId: string }[]).map((admin) => admin.userId)).toEqual([context.userId]);
  expect(result['eligible']).toEqual([]);
});

test('rejects a collection the service does not serve with NOT_FOUND', async () => {
  await expect(new GovernanceService().read(context, 'overview', {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('propagates a store failure', async () => {
  const service = new GovernanceService({ members: () => Promise.reject(Object.assign(new Error('DENIED'), { code: 'DENIED' })) });

  await expect(service.read(context, 'members', {})).rejects.toMatchObject({ code: 'DENIED' });
});

test.each([['range'], ['cursor']])('rejects the query key %s on members with INVALID', async (key) => {
  await expect(new GovernanceService().read(context, 'members', { [key]: 'x' })).rejects.toMatchObject({ code: 'INVALID' });
});
