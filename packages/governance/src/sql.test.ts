import { expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ recordsets: [] as unknown[], error: undefined as Error | undefined, calls: [] as { procedure: string; inputs: Record<string, unknown> }[] }));
vi.mock('mssql', () => ({ default: {
  UniqueIdentifier: 'uuid', BigInt: 'bigint', NVarChar: () => 'nvarchar', Char: () => 'char', MAX: 'max',
  ConnectionPool: class {
    connect() { return Promise.resolve(this); }
    on() { return this; }
    request() { const inputs: Record<string, unknown> = {}; return { input(name: string, _type: unknown, value: unknown) { inputs[name] = value; return this; }, execute(procedure: string) { state.calls.push({ procedure, inputs }); return state.error === undefined ? Promise.resolve({ recordsets: state.recordsets, recordset: state.recordsets[0] ?? [] }) : Promise.reject(state.error); } }; }
  },
} }));

import { AzureSqlGovernanceStore } from './sql.js';

const context = { userId: '33333333-3333-4333-8333-333333333333', groupId: 'a0000000-0000-4000-8000-000000000001', groupEpoch: 4, adminEpoch: 2, tenantIds: [] };
const receipt = { ok: true };

test('maps the three read_members recordsets and lower-cases identifiers', async () => {
  state.error = undefined;
  state.recordsets = [
    [{ tenant_id: 'AAAAAAAA-1111-4111-8111-111111111111', slug: 'alpha', joined_at: new Date('2026-01-02T03:04:05.000Z'), is_billing: true }],
    [{ user_id: 'BBBBBBBB-2222-4222-8222-222222222222', display_name: 'Ada', created_at: new Date() }],
    [{ user_id: 'CCCCCCCC-3333-4333-8333-333333333333', display_name: null }],
  ];

  expect(await new AzureSqlGovernanceStore('members-test').members(context)).toEqual({
    workspaces: [{ tenantId: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'alpha', joinedAt: '2026-01-02T03:04:05.000Z', billing: true }],
    admins: [{ userId: 'bbbbbbbb-2222-4222-8222-222222222222', name: 'Ada' }],
    eligible: [{ userId: 'cccccccc-3333-4333-8333-333333333333', name: '' }],
  });
  expect(state.calls.at(-1)).toEqual({ procedure: 'governance.read_members', inputs: { group_id: context.groupId, user_id: context.userId, group_epoch: 4, admin_epoch: 2 } });
});

test.each([
  ['a missing recordset', [[], []]],
  ['a non-date joined_at', [[{ tenant_id: 'a', slug: 'x', joined_at: 'yesterday', is_billing: false }], [], []]],
  ['a non-string user id', [[], [{ user_id: 7, display_name: 'x' }], []]],
])('refuses read_members with %s as INVALID', async (_name, recordsets) => {
  state.error = undefined; state.recordsets = recordsets;

  await expect(new AzureSqlGovernanceStore('members-test').members(context)).rejects.toMatchObject({ code: 'INVALID' });
});

test('maps read_members SQL errors to domain codes', async () => {
  state.error = Object.assign(new Error('DENIED'), { number: 50001 });

  await expect(new AzureSqlGovernanceStore('members-test').members(context)).rejects.toMatchObject({ code: 'DENIED' });
});

test.each([
  ['add-admin', 'governance.add_admin', 'candidate_user_id', { userId: 'u-1' }, 'u-1'],
  ['remove-admin', 'governance.remove_admin', 'target_user_id', { userId: 'u-2' }, 'u-2'],
  ['set-billing-tenant', 'governance.set_billing_tenant', 'tenant_id', { tenantId: 't-1' }, 't-1'],
  ['add-tenant', 'governance.add_tenant', 'tenant_id', { tenantId: 't-2' }, 't-2'],
] as const)('binds %s to its procedure and parameter', async (name, procedure, parameter, args, expected) => {
  state.error = undefined; state.recordsets = [[{ receipt_json: JSON.stringify(receipt), replayed: false }]];
  const key = '55555555-5555-4555-8555-555555555555';

  expect(await new AzureSqlGovernanceStore('command-test').command(name, context, 4, args, key, 'd'.repeat(64), receipt)).toEqual({ receipt, replayed: false });
  expect(state.calls.at(-1)).toMatchObject({ procedure, inputs: { group_id: context.groupId, user_id: context.userId, group_epoch: 4, admin_epoch: 2, [parameter]: expected, idempotency_key: key } });
});
