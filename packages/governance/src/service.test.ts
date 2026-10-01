import { afterEach, expect, test, vi } from 'vitest';
import type { Backends } from './backend.js';
import { GovernanceService, type GovernanceStore } from './service.js';
import type { HealthRows, PendingApprovalRow } from './attention.js';
import type { OverviewRows, SeriesRow, WindowRow, WorkflowRow } from './reads.js';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const context = { userId: '33333333-3333-4333-8333-333333333333', groupId: 'a0000000-0000-4000-8000-000000000001', groupEpoch: 1, adminEpoch: 1, tenantIds: [tenantA, tenantB] as never };
const unused = (): never => { throw new Error('store must not be called'); };
const stub = (overrides: Partial<GovernanceStore> = {}): GovernanceStore => ({ members: unused, overview: unused, runSeries: unused, workflows: unused, pendingApprovals: unused, health: unused, ...overrides });
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

test.each([['api-latency'], ['logs'], ['trace']])('answers not-configured for the %s panel without a backend or store', async (panel) => {
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

const DIGEST = 'a'.repeat(64);
const waiting = (overrides: Record<string, unknown> = {}): string => JSON.stringify({ nodeId: 'agent', bindingDigest: DIGEST, requestedAt: '2026-09-30T11:50:00.000Z', expiresAt: '2026-09-30T12:30:00.000Z', review: { revision: 2, installationId: 'inst-1', capability: 'write', target: 'crm', argumentsDigest: 'b'.repeat(64), arguments: [{ name: 'subject', type: 'string' }] }, ...overrides });
const pendingRow = (overrides: Partial<PendingApprovalRow> = {}): PendingApprovalRow => ({ tenantId: tenantA, workspace: 'alpha', runId: 'c0000000-0000-4000-8000-000000000001', runVersion: '5', definitionRevision: '2', workflowName: 'Onboarding', waitingJson: waiting(), waitingKind: 'agent', ...overrides });
const approvals = async (rows: PendingApprovalRow[], query: Record<string, string> = {}) => clocked(stub({ pendingApprovals: () => Promise.resolve(rows) })).read(context, 'approvals', query);

test('the approval projection is an allowlist: stored input, argument values and unknown fields never leave', async () => {
  const leaky = waiting({ input: { secret: 'SECRET_INPUT' }, outputs: { note: 'SECRET_OUTPUT' }, extra: 'x', review: { revision: 2, installationId: 'inst-1', capability: 'write', target: 'crm', argumentsDigest: 'b'.repeat(64), input: 'SECRET_INPUT', arguments: [{ name: 'subject', type: 'string', value: 'SECRET_VALUE' }] } });
  const result = await approvals([pendingRow({ waitingJson: leaky })]);

  expect(result['approvals']).toEqual([{ tenantId: tenantA, workspace: 'alpha', runId: 'c0000000-0000-4000-8000-000000000001', runVersion: 5, workflowName: 'Onboarding', revision: 2, nodeId: 'agent', kind: 'tool', capability: 'write', installationId: 'inst-1', target: 'crm', arguments: [{ name: 'subject', type: 'string' }], argumentsDigest: 'b'.repeat(64), requestedAt: '2026-09-30T11:50:00.000Z', expiresAt: '2026-09-30T12:30:00.000Z', bindingDigest: DIGEST }]);
  expect(JSON.stringify(result)).not.toMatch(/SECRET|extra/u);
  expect(result).toMatchObject({ count: 1, completeness: 'full', classification: 'restricted-operational' });
});

test.each([['agent', 'tool'], ['approval', 'step'], [null, 'step']])('maps the waiting history kind %s to %s', async (waitingKind, kind) => {
  expect((await approvals([pendingRow({ waitingKind })]))['approvals']).toMatchObject([{ kind }]);
});

test('omits requestedAt when the run does not carry it, and caps argument names and types', async () => {
  const long = 'n'.repeat(500);
  const json = waiting({ requestedAt: undefined, review: { revision: 2, installationId: 'inst-1', capability: 'write', target: 'crm', argumentsDigest: 'b'.repeat(64), arguments: [{ name: long, type: long }, { name: 7, type: 'string' }, 'text'] } });
  const [approval] = (await approvals([pendingRow({ waitingJson: json })]))['approvals'] as Record<string, unknown>[];

  expect(approval).not.toHaveProperty('requestedAt');
  expect(approval?.['arguments']).toEqual([{ name: 'n'.repeat(128), type: 'n'.repeat(128) }]);
});

test.each([
  ['a missing waiting object', null],
  ['malformed JSON', '{'],
  ['a waiting value that is not an object', '[1]'],
  ['a binding digest that is not 64 hex characters', waiting({ bindingDigest: 'xyz' })],
  ['an expiry that cannot be parsed', waiting({ expiresAt: 'tomorrow' })],
  ['a missing review', waiting({ review: undefined })],
])('skips a row with %s and flags the inbox partial', async (_name, waitingJson) => {
  const result = await approvals([pendingRow({ waitingJson }), pendingRow({ runId: 'c0000000-0000-4000-8000-000000000002' })]);

  expect((result['approvals'] as { runId: string }[]).map((approval) => approval.runId)).toEqual(['c0000000-0000-4000-8000-000000000002']);
  expect(result).toMatchObject({ count: 1, completeness: 'partial' });
});

test('skips a row whose run version is not a safe integer', async () => {
  expect(await approvals([pendingRow({ runVersion: '9007199254740993' })])).toMatchObject({ approvals: [], completeness: 'partial' });
});

test.each([[199, 'full'], [200, 'partial']])('reports %i approvals as %s', async (size, completeness) => {
  const result = await approvals(Array.from({ length: size }, (_unused, index) => pendingRow({ runId: `c0000000-0000-4000-8000-${String(index).padStart(12, '0')}` })));

  expect(result).toMatchObject({ count: size, completeness });
});

test('approvals and health ignore a supplied range or tenant', async () => {
  expect(await approvals([], { range: '2y', tenant: outsider })).toMatchObject({ approvals: [], count: 0 });
  expect(await clocked(stub({ health: () => Promise.resolve({ connectors: [], circuits: [], reconciliation: [] }) })).read(context, 'health', { range: '7d', tenant: outsider })).toMatchObject({ connectors: [] });
  await expect(clocked(stub()).read(context, 'approvals', { cursor: 'x' })).rejects.toMatchObject({ code: 'INVALID' });
});

const SINCE = new Date('2026-09-30T11:00:00.000Z');
const healthRows = (overrides: Partial<HealthRows> = {}): HealthRows => ({
  connectors: [{ tenantId: tenantA, workspace: 'alpha', state: 'healthy', installations: '2' }, { tenantId: tenantA, workspace: 'alpha', state: 'offline', installations: 1 }, { tenantId: tenantB, workspace: 'beta', state: 'revoked', installations: 4 }, { tenantId: tenantB, workspace: 'beta', state: 'mystery', installations: 9 }],
  circuits: [{ tenantId: tenantA, workspace: 'alpha', key: 'model:azure-openai', state: 'open', since: SINCE }, { tenantId: tenantA, workspace: 'alpha', key: null, state: 'probe', since: SINCE }, { tenantId: tenantA, workspace: 'alpha', key: 'connector:<script>', state: 'open', since: SINCE }],
  reconciliation: [{ tenantId: tenantB, workspace: 'beta', runId: 'c0000000-0000-4000-8000-000000000009', since: SINCE }],
  ...overrides,
});
const health = (rows: HealthRows) => clocked(stub({ health: () => Promise.resolve(rows) })).read(context, 'health', {});

test('health counts connectors by state per workspace, names the guarded provider, and lists runs needing reconciliation', async () => {
  const result = await health(healthRows());

  expect(result['connectors']).toEqual([{ tenantId: tenantA, workspace: 'alpha', healthy: 2, offline: 1, revoked: 0 }, { tenantId: tenantB, workspace: 'beta', healthy: 0, offline: 0, revoked: 4 }]);
  expect((result['circuits'] as { key: string; state: string }[]).map(({ key, state }) => [key, state])).toEqual([['model:azure-openai', 'open'], ['unknown', 'probe'], ['unknown', 'open']]);
  expect(result['reconciliation']).toEqual([{ tenantId: tenantB, workspace: 'beta', runId: 'c0000000-0000-4000-8000-000000000009', since: SINCE.toISOString() }]);
  expect(result).toMatchObject({ completeness: 'full', classification: 'restricted-operational' });
});

test('health is partial when a list reaches its cap and drops a circuit that is neither open nor probing', async () => {
  const circuit = { tenantId: tenantA, workspace: 'alpha', key: 'model:x', state: 'open', since: SINCE };
  expect(await health(healthRows({ circuits: Array.from({ length: 100 }, () => circuit) }))).toMatchObject({ completeness: 'partial' });
  const result = await health(healthRows({ circuits: [{ ...circuit, state: 'closed' }] }));

  expect(result).toMatchObject({ circuits: [], completeness: 'partial' });
});

test('serves approvals and health as fixtures for the context workspaces when no store is configured', async () => {
  const service = clocked();
  const inbox = await service.read(context, 'approvals', {});
  const summary = await service.read(context, 'health', {});

  expect(inbox).toMatchObject({ classification: 'fixture', count: 2, completeness: 'full' });
  expect((inbox['approvals'] as { bindingDigest: string; tenantId: string }[]).every((approval) => /^[0-9a-f]{64}$/u.test(approval.bindingDigest) && approval.tenantId === tenantA)).toBe(true);
  expect(summary).toMatchObject({ classification: 'fixture', circuits: [{ key: 'model:openrouter', state: 'open' }] });
  expect(await service.read(context, 'approvals', {})).toEqual(inbox);
  expect(await new GovernanceService(undefined, () => NOW).read({ ...context, tenantIds: [] }, 'approvals', {})).toMatchObject({ approvals: [], count: 0 });
});

const prom = { url: 'http://prom.invalid' };
const backends = (overrides: Partial<Backends> = {}): Backends => ({ prometheus: prom, loki: { url: undefined }, tempo: { url: undefined }, ...overrides });
const matrixBody = JSON.stringify({ status: 'success', data: { resultType: 'matrix', result: [{ metric: {}, values: [[1, '2']] }] } });
const sentQueries = (fetchMock: ReturnType<typeof vi.fn>): string[] => fetchMock.mock.calls.map((call) => new URLSearchParams((call as [string, RequestInit & { body: string }])[1].body).get('query') ?? '');

afterEach(() => { vi.unstubAllGlobals(); });

test('a prometheus panel queries the whole group and reads ready', async () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(matrixBody)));
  vi.stubGlobal('fetch', fetchMock);

  const result = await new GovernanceService(undefined, () => NOW, backends()).read(context, 'series', { range: '24h', panel: 'api-latency' });

  expect(result).toMatchObject({ status: 'ready', completeness: 'full', series: [{ label: 'p50' }, { label: 'p95' }] });
  expect(sentQueries(fetchMock)[0]).toContain(`tenant_id=~"${tenantA}|${tenantB}"`);
});

test('a member tenant narrows the matcher to that workspace', async () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(matrixBody)));
  vi.stubGlobal('fetch', fetchMock);

  await new GovernanceService(undefined, () => NOW, backends()).read(context, 'series', { range: '24h', panel: 'api-latency', tenant: tenantB });

  for (const query of sentQueries(fetchMock)) { expect(query).toContain(`tenant_id=~"${tenantB}"`); expect(query).not.toContain(tenantA); }
});

test('a non-member tenant is denied before any query is sent', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  await expect(new GovernanceService(undefined, () => NOW, backends()).read(context, 'series', { range: '24h', panel: 'api-latency', tenant: outsider })).rejects.toMatchObject({ code: 'DENIED' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('30d reports partial completeness', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(matrixBody))));

  expect(await new GovernanceService(undefined, () => NOW, backends()).read(context, 'series', { range: '30d', panel: 'mcp-outcomes' })).toMatchObject({ completeness: 'partial' });
});

test('an empty group is ready with no series and no query', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const result = await new GovernanceService(undefined, () => NOW, backends()).read({ ...context, tenantIds: [] as never }, 'series', { range: '24h', panel: 'api-latency' });

  expect(result).toMatchObject({ status: 'ready', series: [] });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('a failing backend degrades the panel without failing the request', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 500 }))));

  expect(await new GovernanceService(undefined, () => NOW, backends()).read(context, 'series', { range: '24h', panel: 'api-latency' })).toMatchObject({ status: 'unavailable', series: [] });
});
