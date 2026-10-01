import { afterEach, describe, expect, test, vi } from 'vitest';
import { PlatformApiError } from '../platform-api.js';
import { GovernanceApi } from './governance-api.js';
import { decodeApprovals, decodeLogs, decodeOverview, decodeTrace } from './decoders.js';

afterEach(() => vi.unstubAllGlobals());

const totals = { runs: 10, completed: 9, failed: 1, unknownOutcome: 0, p95Seconds: 1.5, tokens: 100, cost: 0.5 };
const kpis = { ...totals, pendingApprovals: 2, previous: totals };
const overview = { range: '7d', workspaces: [{ ...kpis, tenantId: 't1', name: 'one' }], total: kpis, completeness: 'full', classification: 'restricted-operational' };
const ok = (payload: unknown, status = 200) => new Response(JSON.stringify({ payload }), { status });
const api = () => new GovernanceApi(() => Promise.resolve('tok'));

describe('GovernanceApi', () => {
  test('groups sends the bearer header and decodes the list', async () => {
    const fetch = vi.fn().mockResolvedValue(ok({ groups: [{ id: 'g1', name: 'Group', epoch: 1, adminEpoch: 2, tenantIds: ['t1'] }], completeness: 'full' }));
    vi.stubGlobal('fetch', fetch);

    await expect(api().groups()).resolves.toEqual([{ id: 'g1', name: 'Group', epoch: 1, adminEpoch: 2, tenantIds: ['t1'] }]);
    const [url, init] = fetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('/api/v1/groups');
    expect(init.headers['authorization']).toBe('Bearer tok');
  });

  test('read builds the collection path with the query', async () => {
    const fetch = vi.fn().mockResolvedValue(ok(overview));
    vi.stubGlobal('fetch', fetch);

    await expect(api().read('g1', 'overview', { range: '7d', tenant: 't1' }, decodeOverview)).resolves.toMatchObject({ range: '7d' });
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/v1/groups/g1/overview?range=7d&tenant=t1');
  });

  test('a 403 becomes a PlatformApiError carrying its correlation id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ payload: { error: { category: 'denied' } } }), { status: 403, headers: { 'x-correlation-id': 'corr-1' } })));

    await expect(api().read('g1', 'overview', { range: '7d' }, decodeOverview)).rejects.toMatchObject({ status: 403, category: 'denied', correlationId: 'corr-1' });
  });

  test('rejects a payload with a non-numeric count', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ ...overview, total: { ...kpis, runs: 'NaN' } })));

    await expect(api().read('g1', 'overview', { range: '7d' }, decodeOverview)).rejects.toBeInstanceOf(PlatformApiError);
  });
});

describe('decodeApprovals', () => {
  const row = { tenantId: 't1', workspace: 'w', runId: 'r1', runVersion: 4, workflowName: 'wf', revision: 2, nodeId: 'n', kind: 'tool', capability: 'send', installationId: 'i', target: 'crm', arguments: [{ name: 'a', type: 'string' }], argumentsDigest: 'a'.repeat(64), expiresAt: '2026-01-01T00:00:00.000Z', bindingDigest: 'b'.repeat(64) };
  const body = (entry: unknown) => ({ approvals: [entry], count: 1, completeness: 'full', classification: 'restricted-operational' });

  test('accepts a well-formed row', () => {
    expect(decodeApprovals(body(row)).approvals[0]?.bindingDigest).toBe('b'.repeat(64));
  });

  test.each([
    ['a short binding digest', { ...row, bindingDigest: 'abc' }],
    ['a fractional run version', { ...row, runVersion: 1.5 }],
  ])('rejects %s', (_name, entry) => {
    expect(() => decodeApprovals(body(entry))).toThrow(PlatformApiError);
  });
});

describe('GovernanceApi.command', () => {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const receipt = { commandId: 'c1', objectId: 'g1', revision: 2, state: 'accepted', digest: 'd', evidenceIds: [] };
  const sent = (fetch: ReturnType<typeof vi.fn>, index = 0) => {
    const [url, init] = fetch.mock.calls[index] as [string, { method: string; headers: Record<string, string>; body: string }];
    return { url, headers: init.headers, body: JSON.parse(init.body) as { tenantId?: string; contract: string; payload: { expectedVersion: number; arguments: Record<string, unknown> } } };
  };

  test('create-group posts to the create path with if-match 0 and a null billing tenant', async () => {
    const fetch = vi.fn().mockResolvedValue(ok(receipt));
    vi.stubGlobal('fetch', fetch);

    await api().command({ name: 'create-group', expectedVersion: 0, arguments: { name: 'Ops', tenantIds: [uuid(1)], billingTenantId: null } });
    const { url, headers, body } = sent(fetch);
    expect(url).toBe('/api/v1/groups/commands/governance/create-group');
    expect(headers['if-match']).toBe('0');
    expect(headers['x-platform-tenant']).toBeUndefined();
    expect(body.contract).toBe('governance.v1');
    expect(body).not.toHaveProperty('tenantId');
    expect(body.payload.arguments['billingTenantId']).toBeNull();
  });

  test('add-tenant posts to the group path with the epoch as if-match', async () => {
    const fetch = vi.fn().mockResolvedValue(ok(receipt));
    vi.stubGlobal('fetch', fetch);

    await api().command({ groupId: 'g1', name: 'add-tenant', expectedVersion: 7, arguments: { tenantId: uuid(2) } });
    const { url, headers, body } = sent(fetch);
    expect(url).toBe('/api/v1/groups/g1/commands/governance/add-tenant');
    expect(headers['if-match']).toBe('7');
    expect(body.payload.expectedVersion).toBe(7);
  });

  test('identical commands reuse the idempotency key and a different argument gets a new one', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(ok(receipt)));
    vi.stubGlobal('fetch', fetch);
    const client = api();
    const add = (tenantId: string) => client.command({ groupId: 'g1', name: 'add-tenant', expectedVersion: 1, arguments: { tenantId } });

    await add(uuid(2)); await add(uuid(2)); await add(uuid(3));
    expect(sent(fetch, 0).headers['idempotency-key']).toBe(sent(fetch, 1).headers['idempotency-key']);
    expect(sent(fetch, 2).headers['idempotency-key']).not.toBe(sent(fetch, 0).headers['idempotency-key']);
  });

  test.each([
    ['51 tenant ids', { name: 'Ops', tenantIds: Array.from({ length: 51 }, (_, i) => uuid(i + 1)), billingTenantId: null }],
    ['an empty name', { name: '', tenantIds: [uuid(1)], billingTenantId: null }],
  ])('rejects %s before any request', async (_label, args) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(api().command({ name: 'create-group', expectedVersion: 0, arguments: args })).rejects.toBeInstanceOf(PlatformApiError);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('a 409 becomes a PlatformApiError with status 409', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ payload: { error: { category: 'conflict' } } }), { status: 409 })));

    await expect(api().command({ groupId: 'g1', name: 'add-tenant', expectedVersion: 1, arguments: { tenantId: uuid(2) } })).rejects.toMatchObject({ status: 409 });
  });
});

describe('GovernanceApi.members', () => {
  test('decodes workspaces, admins and eligible people', async () => {
    const body = { workspaces: [{ tenantId: 't1', name: 'one', joinedAt: '2026-01-01T00:00:00.000Z', billing: true }], admins: [{ userId: 'u1', name: 'Ada' }], eligible: [{ userId: 'u2', name: 'Bo' }], completeness: 'full', classification: 'restricted-operational' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(body)));

    await expect(api().members('g1')).resolves.toMatchObject({ workspaces: [{ tenantId: 't1', billing: true }], admins: [{ userId: 'u1' }], eligible: [{ userId: 'u2' }] });
  });

  test('rejects a workspace without a billing flag', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ workspaces: [{ tenantId: 't1', name: 'one', joinedAt: 'x' }], admins: [], eligible: [] })));

    await expect(api().members('g1')).rejects.toBeInstanceOf(PlatformApiError);
  });
});

describe('decodeLogs and decodeTrace', () => {
  const logs = (entry: unknown) => ({ range: '7d', status: 'ready', entries: [entry], completeness: 'full', classification: 'restricted-operational' });
  const entry = { at: '2026-01-01T00:00:00.000Z', event: 'run.started', level: 'info', attributes: { run_id: 'r', attempt: 1, ok: true } };
  const trace = (span: unknown) => ({ run: 'r', status: 'ready', spans: [span], completeness: 'full', classification: 'restricted-operational' });
  const span = { traceId: 't', spanId: 's', name: 'n', startMs: 5, durationMs: 3, status: 'error', attributes: { a: 'b' } };

  test('accepts well-formed entries and a continuation', () => {
    expect(decodeLogs({ ...logs(entry), continuation: { cursor: 'c' } })).toMatchObject({ entries: [{ event: 'run.started' }], continuation: { cursor: 'c' } });
  });

  test('rejects an entry whose attribute value is an object', () => {
    expect(() => decodeLogs(logs({ ...entry, attributes: { a: { b: 1 } } }))).toThrow(PlatformApiError);
  });

  test('accepts a span and rejects a negative duration', () => {
    expect(decodeTrace(trace(span)).spans[0]?.status).toBe('error');
    expect(() => decodeTrace(trace({ ...span, durationMs: -1 }))).toThrow(PlatformApiError);
  });
});
