import { expect, test } from 'vitest';
import { GovernanceService, type GovernanceStore } from './service.js';
import type { OverviewRows, SeriesRow, WindowRow, WorkflowRow } from './reads.js';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const context = { userId: '33333333-3333-4333-8333-333333333333', groupId: 'a0000000-0000-4000-8000-000000000001', groupEpoch: 1, adminEpoch: 1, tenantIds: [tenantA, tenantB] as never };
const unused = (): never => { throw new Error('store must not be called'); };
const stub = (overrides: Partial<GovernanceStore> = {}): GovernanceStore => ({ members: unused, overview: unused, runSeries: unused, workflows: unused, ...overrides });
const members = { workspaces: [{ tenantId: tenantA, name: 'one', joinedAt: '2026-01-01T00:00:00.000Z', billing: true }], admins: [{ userId: context.userId, name: 'Ada' }], eligible: [] };

test('returns the store data labelled full and restricted-operational', async () => {
  const seen: unknown[] = [];
  const service = new GovernanceService(stub({ members: (input) => { seen.push(input); return Promise.resolve(members); } }));

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
  await expect(new GovernanceService().read(context, 'nope', {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('propagates a store failure', async () => {
  const service = new GovernanceService(stub({ members: () => Promise.reject(Object.assign(new Error('DENIED'), { code: 'DENIED' })) }));

  await expect(service.read(context, 'members', {})).rejects.toMatchObject({ code: 'DENIED' });
});

test.each([['range'], ['cursor']])('rejects the query key %s on members with INVALID', async (key) => {
  await expect(new GovernanceService().read(context, 'members', { [key]: 'x' })).rejects.toMatchObject({ code: 'INVALID' });
});

const NOW = Date.parse('2026-09-30T12:00:00.000Z');
const outsider = '99999999-9999-4999-8999-999999999999';
const zero: Omit<WindowRow, 'window'> = { runs: 0, completed: 0, failed: 0, unknownOutcome: 0, p95Ms: null, tokens: 0, cost: 0, estimatedRuns: 0 };
const overviewRows = (overrides: Partial<WindowRow> = {}): OverviewRows => ({
  workspaces: [
    { tenantId: tenantA, name: 'alpha', window: 'current', ...zero, runs: '12', completed: 9, failed: 2, unknownOutcome: 1, p95Ms: 2500, tokens: '3000', cost: 1.25, ...overrides },
    { tenantId: tenantA, name: 'alpha', window: 'previous', ...zero, runs: 4, completed: 4 },
    { tenantId: tenantB, name: 'beta', window: 'current', ...zero },
    { tenantId: tenantB, name: 'beta', window: 'previous', ...zero },
  ],
  totals: [{ window: 'current', ...zero, runs: 12, completed: 9, failed: 2, unknownOutcome: 1, p95Ms: 2500, tokens: 3000, cost: 1.25, ...overrides }, { window: 'previous', ...zero, runs: 4, completed: 4 }],
  pending: [{ tenantId: tenantA, pendingApprovals: '3' }],
});
const clocked = (store?: GovernanceStore) => new GovernanceService(store, () => NOW);

test.each([
  ['an unsupported range', { range: '2y' }],
  ['a missing range', {}],
  ['a tenant that is not a UUID', { range: '7d', tenant: 'nope' }],
  ['an unknown key', { range: '7d', level: 'info' }],
])('rejects %s on overview with INVALID before any store call', async (_name, query) => {
  await expect(clocked(stub()).read(context, 'overview', query)).rejects.toMatchObject({ code: 'INVALID' });
});

test('rejects a tenant outside the group with DENIED and never calls the store', async () => {
  await expect(clocked(stub()).read(context, 'overview', { range: '7d', tenant: outsider })).rejects.toMatchObject({ code: 'DENIED' });
  await expect(clocked(stub()).read(context, 'workflows', { range: '7d', tenant: outsider })).rejects.toMatchObject({ code: 'DENIED' });
  await expect(clocked(stub()).read(context, 'series', { range: '7d', panel: 'runs-over-time', tenant: outsider })).rejects.toMatchObject({ code: 'DENIED' });
});

test('overview converts string counts, keeps empty workspaces at zero and pairs each window with its predecessor', async () => {
  const seen: unknown[][] = [];
  const result = await clocked(stub({ overview: (...args) => { seen.push(args.slice(1)); return Promise.resolve(overviewRows()); } })).read(context, 'overview', { range: '7d', tenant: tenantA.toUpperCase() });

  expect(seen).toEqual([[new Date(NOW - 604_800_000), new Date(NOW), tenantA]]);
  expect(result).toMatchObject({ range: '7d', classification: 'restricted-operational', completeness: 'full' });
  const [alpha, beta] = result['workspaces'] as Record<string, unknown>[];
  expect(alpha).toEqual({ tenantId: tenantA, name: 'alpha', runs: 12, completed: 9, failed: 2, unknownOutcome: 1, p95Seconds: 2.5, tokens: 3000, cost: 1.25, pendingApprovals: 3, previous: { runs: 4, completed: 4, failed: 0, unknownOutcome: 0, p95Seconds: null, tokens: 0, cost: 0 } });
  expect(beta).toMatchObject({ tenantId: tenantB, runs: 0, p95Seconds: null, pendingApprovals: 0 });
  expect(result['total']).toMatchObject({ runs: 12, pendingApprovals: 3, previous: { runs: 4 } });
});

test.each([
  ['beyond the safe-integer range', '9007199254740993'],
  ['negative', -1],
  ['fractional', 1.5],
  ['not numeric', '12abc'],
])('rejects a count that is %s', async (_name, runs) => {
  await expect(clocked(stub({ overview: () => Promise.resolve(overviewRows({ runs })) })).read(context, 'overview', { range: '7d' })).rejects.toBeDefined();
});

test('marks the overview partial when the current window holds an estimated run', async () => {
  const result = await clocked(stub({ overview: () => Promise.resolve(overviewRows({ estimatedRuns: '2' })) })).read(context, 'overview', { range: '24h' });

  expect(result['completeness']).toBe('partial');
});

const seriesRow = (bucketStart: number, overrides: Partial<SeriesRow> = {}): SeriesRow => ({ tenantId: tenantA, name: 'alpha', bucketStart: new Date(bucketStart), completed: 2, failed: 1, unknownOutcome: 0, cost: 0.5, tokens: 10, estimatedRuns: 0, ...overrides });

test('series zero-fills every bucket, ascending, with 288 points per line for 24h', async () => {
  const from = NOW - 86_400_000;
  const rows = [seriesRow(from + 300_000), seriesRow(from + 300_000, { tenantId: tenantB, name: 'beta', completed: '3' }), seriesRow(from - 300_000), seriesRow(NOW + 300_000)];
  const result = await clocked(stub({ runSeries: () => Promise.resolve(rows) })).read(context, 'series', { range: '24h', panel: 'runs-over-time' });
  const lines = result['series'] as { label: string; points: [number, number][] }[];

  expect(result).toMatchObject({ status: 'ready', panel: 'runs-over-time', range: '24h', completeness: 'full' });
  expect(lines.map((line) => line.label)).toEqual(['completed', 'failed', 'unknown-outcome']);
  for (const line of lines) {
    expect(line.points).toHaveLength(288);
    expect(line.points.map(([time]) => time)).toEqual(Array.from({ length: 288 }, (_unused, index) => from + index * 300_000));
  }
  expect(lines[0]?.points[1]).toEqual([from + 300_000, 5]);
  expect(lines[0]?.points.reduce((sum, [, value]) => sum + value, 0)).toBe(5);
  expect(lines[1]?.points[0]).toEqual([from, 0]);
});

test('spend-by-workspace draws one line per workspace holding cost', async () => {
  const from = NOW - 3_600_000;
  const result = await clocked(stub({ runSeries: () => Promise.resolve([seriesRow(from, { cost: '1.5' }), seriesRow(from + 60_000, { tenantId: tenantB, name: 'beta', cost: 0.25 })]) })).read(context, 'series', { range: '1h', panel: 'spend-by-workspace' });
  const lines = result['series'] as { label: string; points: [number, number][] }[];

  expect(lines.map((line) => line.label)).toEqual(['alpha', 'beta']);
  expect(lines[0]?.points).toHaveLength(60);
  expect(lines[0]?.points[0]).toEqual([from, 1.5]);
  expect(lines[1]?.points[1]).toEqual([from + 60_000, 0.25]);
});

test.each([['api-latency'], ['logs'], ['trace']])('answers not-configured for the %s panel without touching the store', async (panel) => {
  expect(await clocked(stub()).read(context, 'series', { range: '7d', panel })).toMatchObject({ status: 'not-configured', series: [] });
});

test.each([['nope'], ['__proto__'], ['constructor']])('rejects the panel id %s with INVALID', async (panel) => {
  await expect(clocked(stub()).read(context, 'series', { range: '7d', panel })).rejects.toMatchObject({ code: 'INVALID' });
  await expect(clocked(stub()).read(context, 'series', { range: '7d' })).rejects.toMatchObject({ code: 'INVALID' });
});

test('workflows report success rate, p95 and a short-id name fallback, and never divide by zero', async () => {
  const row = (overrides: Partial<WorkflowRow>): WorkflowRow => ({ tenantId: tenantA, workspace: 'alpha', definitionId: 'abcdef12-0000-4000-8000-000000000000', name: 'Onboarding', runs: 4, completed: 3, p95Ms: null, cost: 2, estimatedRuns: 0, ...overrides });
  const result = await clocked(stub({ workflows: () => Promise.resolve([row({ p95Ms: '4000' }), row({ name: null, runs: 0, completed: 0 }), row({ name: '   ' })]) })).read(context, 'workflows', { range: '30d' });
  const [first, second, third] = result['workflows'] as Record<string, unknown>[];

  expect(first).toMatchObject({ name: 'Onboarding', runs: 4, successRate: 0.75, p95Seconds: 4, cost: 2 });
  expect(second).toMatchObject({ name: 'abcdef12', runs: 0, successRate: null, p95Seconds: null });
  expect(third).toMatchObject({ name: 'abcdef12' });
  expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity|-0[,}]/u);
});

test('serves all three collections as fixtures for exactly the context workspaces when no store is configured', async () => {
  const service = clocked();
  const overview = await service.read(context, 'overview', { range: '7d' });
  const series = await service.read(context, 'series', { range: '24h', panel: 'runs-over-time' });
  const workflows = await service.read(context, 'workflows', { range: '7d', tenant: tenantB });

  expect(overview['classification']).toBe('fixture');
  expect((overview['workspaces'] as { tenantId: string }[]).map((workspace) => workspace.tenantId)).toEqual([tenantA, tenantB]);
  expect(series).toMatchObject({ classification: 'fixture', status: 'ready' });
  expect((series['series'] as { points: unknown[] }[])[0]?.points).toHaveLength(288);
  expect(workflows['classification']).toBe('fixture');
  expect((workflows['workflows'] as { tenantId: string }[]).map((workflow) => workflow.tenantId)).toEqual([tenantB]);
  expect(JSON.stringify(await service.read(context, 'overview', { range: '7d' }))).toBe(JSON.stringify(overview));
});
