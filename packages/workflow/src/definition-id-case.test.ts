import { expect, test } from 'vitest';
import { WorkflowWorker } from './runtime.js';
import type { WorkflowRun } from './service.js';
import type { PublishedDefinition, WorkflowRecord, WorkflowStore } from './sql.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const lower = '22222222-aaaa-4222-8222-bbbbbbbbbbbb';
const digest = 'a'.repeat(64);
const definition = { id: lower, digest, start: 'trigger', nodes: [{ id: 'trigger', kind: 'trigger', title: 't', next: 'done', config: { mode: 'webhook', inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false } } }, { id: 'done', kind: 'end', title: 'e', config: {} }] };
const published = { id: lower, draftId: lower, draftRevision: 1, digest, definition } as unknown as PublishedDefinition;
const run: WorkflowRun = { id: '33333333-3333-4333-8333-333333333333', tenantId: tenant, ownerId: 'webhook', stableDefinitionId: lower, definitionId: lower, definitionRevision: 1, definitionDigest: digest, inputDigest: digest, input: {}, status: 'queued', history: [], outputs: {}, summaryStatus: 'pending' };

test('a run stays valid when the orchestrator passes the definition id in another letter case', async () => {
  const store = {
    workerDefinition: async () => published,
    workerRead: async () => ({ id: run.id, kind: 'run', version: 1, state: 'queued', data: run }) as unknown as WorkflowRecord<WorkflowRun>,
    workerWrite: async (_t: string, kind: string, id: string, version: number, state: string, data: unknown) => ({ id, kind, version: version + 1, state, data }),
  } as unknown as WorkflowStore;
  const worker = new WorkflowWorker(store, { complete: async () => { throw new Error('unused'); } } as never, { invoke: async () => { throw new Error('unused'); } } as never, {} as never);
  await expect(worker.step(tenant, run.id, lower.toUpperCase(), 'trigger')).resolves.not.toThrow();
});
