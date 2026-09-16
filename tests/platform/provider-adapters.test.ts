import { describe, expect, test } from 'vitest';

import { BlobAdapter, BoardsAdapter, GraphAdapter, JiraAdapter, ProviderCheckpoints, SqlAdapter, type ProviderRequest, type ProviderTransport } from '../../packages/providers/src/index.js';

const tenantId = '22222222-2222-4222-8222-222222222222';
const installationId = 'installation-1';
const accountId = 'account-1';
const request = (operation: string, resource: string, arguments_: Record<string, unknown> = {}) => ({ effectId: 'effect-1', attemptId: 'attempt-1', operation, accountId, resource, arguments: arguments_, deadline: '2099-01-01T00:00:00.000Z', credential: { installationId, scope: operation } });
const calls: ProviderRequest[] = [];
const transport: ProviderTransport = { execute: (item) => { calls.push(item); return { status: 200, receipt: 'receipt-1', checkpoint: 'cursor-1' }; }, reconcile: () => ({ found: true, checkpoint: 'cursor-2' }), reset: (item) => ({ removed: item.inventory, residual: [] }) };

describe('constrained live-provider adapter boundaries', () => {
  test('permits only allocated resources, persists scoped checkpoints, and denies cross-scope calls before transport', async () => {
    const checkpoints = new ProviderCheckpoints();
    const adapters = [
      [new GraphAdapter({ tenantId, installationId, accountId, schemaVersion: 'v1', credentialEpoch: 1, scope: 'tenant-1', userIds: ['users/demo'], groupId: 'demo-group' }, transport, checkpoints), request('graph.membership.add', 'groups/demo-group', { userId: 'users/demo' })],
      [new SqlAdapter({ tenantId, installationId, accountId, schemaVersion: 'v1', credentialEpoch: 1, scope: 'tenant-1', tables: ['dbo.Validation'] }, transport, checkpoints), request('sql.upsert', 'dbo.Validation', { runId: 'run-1' })],
      [new BlobAdapter({ tenantId, installationId, accountId, schemaVersion: 'v1', credentialEpoch: 1, scope: 'tenant-1', sourceManifest: 'source/manifest.json', outputPrefix: 'handoff/' }, transport, checkpoints), request('blob.artifact.write', 'handoff/result.json', { etag: 'etag-1' })],
      [new BoardsAdapter({ tenantId, installationId, accountId, schemaVersion: 'v1', credentialEpoch: 1, scope: 'tenant-1', project: 'demo', itemIds: ['projects/demo/items/1'], marker: 'demo-run' }, transport, checkpoints), request('boards.item.upsert', 'projects/demo/items/new', { marker: 'demo-run', revision: '1' })],
      [new JiraAdapter({ tenantId, installationId, accountId, schemaVersion: 'v1', credentialEpoch: 1, scope: 'tenant-1', site: 'site-1', project: 'ACCESS', evidenceIssueIds: ['sites/site-1/projects/ACCESS/issues/1'], marker: 'demo-run' }, transport, checkpoints), request('jira.review.revoke', 'sites/site-1/projects/ACCESS/issues/2', { marker: 'demo-run', version: '1' })],
    ] as const;
    for (const [adapter, input] of adapters) { await expect(adapter.invoke(input)).resolves.toMatchObject({ outcome: 'succeeded', providerRef: 'receipt-1' }); await expect(adapter.reconcile(input)).resolves.toBe('succeeded'); expect(adapter.checkpoint()?.cursor).toBe('cursor-2'); await expect(adapter.reset()).resolves.toEqual({ state: 'complete', residual: [] }); }
    const before = calls.length;
    await expect(adapters[0][0].invoke(request('graph.membership.add', 'groups/foreign', { userId: 'users/demo' }))).resolves.toEqual({ outcome: 'provider-rejected' });
    await expect(adapters[2][0].invoke(request('blob.artifact.write', 'handoff/../foreign', { etag: 'etag-1' }))).resolves.toEqual({ outcome: 'provider-rejected' });
    await expect(adapters[1][0].invoke(request('sql.upsert', 'dbo.Foreign', { runId: 'run-1' }))).resolves.toEqual({ outcome: 'provider-rejected' });
    expect(calls).toHaveLength(before);
    expect(() => checkpoints.advance({ provider: 'graph', tenantId, installationId, accountId, schemaVersion: 'v2', credentialEpoch: 1, scope: 'tenant-1', cursor: 'cursor-3' })).toThrow('Provider checkpoint scope changed.');
  });

  test('maps throttling and unknown post-send outcomes without unsafe retry', async () => {
    const throttled: ProviderTransport = { execute: () => ({ status: 429, retryAfterSeconds: 5 }), reconcile: () => { throw new Error('network'); }, reset: () => ({ removed: [], residual: [] }) };
    const adapter = new GraphAdapter({ tenantId, installationId, accountId, schemaVersion: 'v1', credentialEpoch: 1, scope: 'tenant-1', userIds: ['users/demo'], groupId: 'demo-group' }, throttled);
    await expect(adapter.invoke(request('graph.user.read', 'users/demo'))).resolves.toEqual({ outcome: 'throttled', retryAfterSeconds: 5 });
    const unknown: ProviderTransport = { execute: () => { throw new Error('post-send timeout'); }, reconcile: () => ({ found: false }), reset: () => ({ removed: [], residual: [] }) };
    const timeout = new GraphAdapter({ tenantId, installationId, accountId, schemaVersion: 'v1', credentialEpoch: 1, scope: 'tenant-1', userIds: ['users/demo'], groupId: 'demo-group' }, unknown);
    await expect(timeout.invoke(request('graph.user.read', 'users/demo'))).resolves.toEqual({ outcome: 'unknown-outcome' });
    await expect(timeout.reconcile(request('graph.user.read', 'users/demo'))).resolves.toBe('not-found');
  });
});
