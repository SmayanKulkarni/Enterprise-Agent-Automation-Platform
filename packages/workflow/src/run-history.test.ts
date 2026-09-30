import { expect, test, vi } from 'vitest';
import { tenantId } from '../../contracts/src/index.js';
import type { RunHistoryPage } from './sql.js';
import type { WorkflowRun } from './service.js';
import { WorkflowService } from './service.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const otherTenant = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const otherRunId = '44444444-4444-4444-8444-444444444444';
const context = { mode: 'interactive' as const, userId: 'user-1', tenantId: tenantId(tenant), expiresAt: '2099-01-01T00:00:00.000Z', membershipEpoch: 1, tenantEpoch: 1, sessionId: 'session-1' };

const run = (id: string): WorkflowRun => ({ id, tenantId: tenant, ownerId: 'user-1', stableDefinitionId: '55555555-5555-4555-8555-555555555555', definitionId: '66666666-6666-4666-8666-666666666666', definitionRevision: 1, definitionDigest: 'a'.repeat(64), inputDigest: 'b'.repeat(64), input: { request: 'raw input must not be projected' }, status: 'completed', history: [], outputs: {} });

test('projects one bounded Run History page with its redacted child evidence', async () => {
  const page: RunHistoryPage = {
    runs: [{ id: runId, kind: 'run', version: 1, state: 'completed', data: run(runId), createdAt: '2026-01-01T00:00:00.0000000' }],
    effects: [{ id: '77777777-7777-4777-8777-777777777777', kind: 'effect', version: 1, state: 'succeeded', data: { runId, nodeId: 'effect', requestDigest: 'c'.repeat(64), argumentsDigest: 'd'.repeat(64), arguments: 'raw arguments must not be projected' } }],
    retrievals: [{ id: '88888888-8888-4888-8888-888888888888', kind: 'memory-retrieval', version: 1, state: 'completed', data: { runId, nodeId: 'memory', status: 'success', itemIds: [], importIds: [] } }],
    hasMore: true,
  };
  const runHistory = vi.fn((): Promise<RunHistoryPage> => Promise.resolve(page));
  const service = new WorkflowService(undefined as never, { runHistory } as never);

  const projection = await service.projection(context, 'workflow-runs', undefined, { pageSize: 1 });

  expect(runHistory).toHaveBeenCalledWith(context, 1, undefined, undefined);
  expect(projection['records']).toMatchObject([{ id: runId, effects: [{ nodeId: 'effect', argumentsDigest: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' }], retrievals: [{ nodeId: 'memory', status: 'success' }] }]);
  expect(typeof (projection['continuation'] as { cursor?: unknown } | undefined)?.cursor).toBe('string');
  expect(JSON.stringify(projection)).not.toContain('raw input must not be projected');
  expect(JSON.stringify(projection)).not.toContain('raw arguments must not be projected');
});

test('projects run usage and the approval request time next to the existing run fields', async () => {
  const waiting = { nodeId: 'approval', bindingDigest: 'e'.repeat(64), expiresAt: '2026-01-01T01:00:00.000Z', requestedAt: '2026-01-01T00:00:00.000Z' };
  const data: WorkflowRun = { ...run(runId), status: 'waiting-approval', waiting, usage: { tokens: 20, cost: 0.01, modelCalls: 1 } };
  const runHistory = (): Promise<RunHistoryPage> => Promise.resolve({ runs: [{ id: runId, kind: 'run', version: 1, state: 'waiting-approval', data, createdAt: '2026-01-01T00:00:00.0000000' }], effects: [], retrievals: [], hasMore: false });
  const service = new WorkflowService(undefined as never, { runHistory } as never);

  const [projected] = (await service.projection(context, 'workflow-runs'))['records'] as Record<string, unknown>[];

  expect(Object.keys(projected ?? {}).sort()).toEqual(['definitionDigest', 'definitionId', 'definitionRevision', 'effects', 'history', 'id', 'inputDigest', 'inputSummary', 'retrievals', 'stableDefinitionId', 'status', 'usage', 'version', 'waiting']);
  expect(projected).toMatchObject({ usage: { tokens: 20, cost: 0.01, modelCalls: 1 }, waiting });
});

test('rejects a Run History cursor from another tenant', async () => {
  const service = new WorkflowService(undefined as never, { runHistory: () => Promise.resolve({ runs: [], effects: [], retrievals: [], hasMore: false }) } as never);
  const cursor = Buffer.from(`${otherTenant}.${JSON.stringify({ createdAt: '2026-01-01T00:00:00.0000000', id: otherRunId })}`).toString('base64url');

  await expect(service.projection(context, 'workflow-runs', undefined, { cursor })).rejects.toMatchObject({ code: 'DENIED' });
  await expect(service.projection(context, 'workflow-runs', undefined, { cursor: 'broken' })).rejects.toMatchObject({ code: 'DENIED' });
});
