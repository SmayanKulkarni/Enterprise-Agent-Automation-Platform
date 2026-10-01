import { afterEach, describe, expect, test, vi } from 'vitest';
import { PlatformApiError } from '../platform-api.js';
import { GovernanceApi } from './governance-api.js';
import { decodeApprovals, decodeOverview } from './decoders.js';

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
