import { expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ recordsets: [] as unknown[], error: undefined as Error | undefined, calls: [] as { procedure: string; inputs: Record<string, unknown> }[] }));
vi.mock('mssql', () => ({ default: {
  UniqueIdentifier: 'uuid', BigInt: 'bigint', Int: 'int', DateTime2: () => 'datetime2', NVarChar: () => 'nvarchar', Char: () => 'char', MAX: 'max',
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

const from = new Date('2026-09-23T12:00:00.000Z'); const to = new Date('2026-09-30T12:00:00.000Z');
const row = { runs: '12', completed: 9, failed: 2, unknown_outcome: 1, p95_ms: 2500, tokens: '3000', cost: 1.25, estimated_runs: 0 };

test('binds the window and tenant, and maps the three read_overview recordsets with bigint counts kept as strings', async () => {
  state.error = undefined;
  state.recordsets = [
    [{ tenant_id: 'AAAAAAAA-1111-4111-8111-111111111111', slug: 'alpha', window: 'current', ...row }],
    [{ window: 'previous', ...row, p95_ms: null }],
    [{ tenant_id: 'AAAAAAAA-1111-4111-8111-111111111111', pending_approvals: 3 }],
  ];

  const result = await new AzureSqlGovernanceStore('overview-test').overview(context, from, to, 'aaaaaaaa-1111-4111-8111-111111111111');

  expect(result.workspaces).toEqual([{ tenantId: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'alpha', window: 'current', runs: '12', completed: 9, failed: 2, unknownOutcome: 1, p95Ms: 2500, tokens: '3000', cost: 1.25, estimatedRuns: 0 }]);
  expect(result.totals[0]).toMatchObject({ window: 'previous', p95Ms: null });
  expect(result.pending).toEqual([{ tenantId: 'aaaaaaaa-1111-4111-8111-111111111111', pendingApprovals: 3 }]);
  expect(state.calls.at(-1)).toEqual({ procedure: 'governance.read_overview', inputs: { group_id: context.groupId, user_id: context.userId, group_epoch: 4, admin_epoch: 2, from, to, tenant_id: 'aaaaaaaa-1111-4111-8111-111111111111' } });
});

test('passes a null tenant and the bucket size to read_run_series and read_workflows', async () => {
  state.error = undefined;
  state.recordsets = [[{ tenant_id: 'AAAAAAAA-1111-4111-8111-111111111111', slug: 'alpha', bucket_start: from, completed: 1, failed: 0, unknown_outcome: 0, cost: 0.5, tokens: '10', estimated_runs: 0 }]];
  const store = new AzureSqlGovernanceStore('series-test');

  expect(await store.runSeries(context, from, to, 60)).toEqual([{ tenantId: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'alpha', bucketStart: from, completed: 1, failed: 0, unknownOutcome: 0, cost: 0.5, tokens: '10', estimatedRuns: 0 }]);
  expect(state.calls.at(-1)?.inputs).toMatchObject({ bucket_minutes: 60, tenant_id: null });

  state.recordsets = [[{ tenant_id: 'AAAAAAAA-1111-4111-8111-111111111111', slug: 'alpha', stable_definition_id: 'BBBBBBBB-2222-4222-8222-222222222222', name: null, runs: 4, completed: 3, p95_ms: null, cost: 2, estimated_runs: 0 }]];
  expect(await store.workflows(context, from, to)).toEqual([{ tenantId: 'aaaaaaaa-1111-4111-8111-111111111111', workspace: 'alpha', definitionId: 'bbbbbbbb-2222-4222-8222-222222222222', name: null, runs: 4, completed: 3, p95Ms: null, cost: 2, estimatedRuns: 0 }]);
  expect(state.calls.at(-1)).toMatchObject({ procedure: 'governance.read_workflows', inputs: { tenant_id: null } });
});

test.each([
  ['a window name outside current and previous', [[{ tenant_id: 'a', slug: 'x', window: 'older', ...row }], [], []]],
  ['a non-numeric count', [[{ tenant_id: 'a', slug: 'x', window: 'current', ...row, runs: {} }], [], []]],
])('refuses read_overview with %s as INVALID', async (_name, recordsets) => {
  state.error = undefined; state.recordsets = recordsets;

  await expect(new AzureSqlGovernanceStore('overview-test').overview(context, from, to)).rejects.toMatchObject({ code: 'INVALID' });
});

test('maps read_pending_approvals rows without touching the stored waiting text', async () => {
  state.error = undefined;
  state.recordsets = [[{ tenant_id: 'AAAAAAAA-1111-4111-8111-111111111111', slug: 'alpha', run_id: 'BBBBBBBB-2222-4222-8222-222222222222', run_version: '5', definition_revision: '2', workflow_name: null, run_label: 'o/r#7', waiting_json: '{"nodeId":"agent"}', waiting_kind: 'agent' }]];

  expect(await new AzureSqlGovernanceStore('pending-test').pendingApprovals(context)).toEqual([{ tenantId: 'aaaaaaaa-1111-4111-8111-111111111111', workspace: 'alpha', runId: 'bbbbbbbb-2222-4222-8222-222222222222', runVersion: '5', definitionRevision: '2', workflowName: null, runLabel: 'o/r#7', waitingJson: '{"nodeId":"agent"}', waitingKind: 'agent' }]);
  expect(state.calls.at(-1)).toEqual({ procedure: 'governance.read_pending_approvals', inputs: { group_id: context.groupId, user_id: context.userId, group_epoch: 4, admin_epoch: 2 } });
});

test('maps the three read_health recordsets and refuses a circuit without a timestamp', async () => {
  const at = new Date('2026-09-30T11:00:00.000Z');
  state.error = undefined;
  state.recordsets = [
    [{ tenant_id: 'AAAAAAAA-1111-4111-8111-111111111111', slug: 'alpha', state: 'healthy', installations: 2 }],
    [{ tenant_id: 'AAAAAAAA-1111-4111-8111-111111111111', slug: 'alpha', circuit_key: null, state: 'open', updated_at: at }],
    [{ tenant_id: 'AAAAAAAA-1111-4111-8111-111111111111', slug: 'alpha', run_id: 'BBBBBBBB-2222-4222-8222-222222222222', finished_at: at }],
  ];
  const store = new AzureSqlGovernanceStore('health-test');

  expect(await store.health(context)).toEqual({
    connectors: [{ tenantId: 'aaaaaaaa-1111-4111-8111-111111111111', workspace: 'alpha', state: 'healthy', installations: 2 }],
    circuits: [{ tenantId: 'aaaaaaaa-1111-4111-8111-111111111111', workspace: 'alpha', key: null, state: 'open', since: at }],
    reconciliation: [{ tenantId: 'aaaaaaaa-1111-4111-8111-111111111111', workspace: 'alpha', runId: 'bbbbbbbb-2222-4222-8222-222222222222', since: at }],
  });
  state.recordsets = [[], [{ tenant_id: 'a', slug: 'x', circuit_key: null, state: 'open', updated_at: 'yesterday' }], []];
  await expect(store.health(context)).rejects.toMatchObject({ code: 'INVALID' });
});
