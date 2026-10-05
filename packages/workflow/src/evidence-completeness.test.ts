import { expect, test } from 'vitest';
import type { CompiledNode } from './graph.js';
import type { ModelRequest } from './runtime.js';
import { MemoryRecords, POLICY, TENANT, install, mcpNode, pinFor, publish, readRun, seedRun, shape, worker, type PinSpec } from './worker-harness.test-support.js';

const READ: PinSpec = { risk: 'R1', capability: 'read_diff', inputSchema: shape({}), outputSchema: shape({ result: { type: 'string' } }) };
const WRITE: PinSpec = { risk: 'R2', capability: 'write_issue', inputSchema: shape({ title: { type: 'string' } }), outputSchema: shape({ result: { type: 'string' } }) };

const model = (calls: { count: number }) => ({
  complete: async (request: ModelRequest) => {
    calls.count += 1;
    return calls.count === 1
      ? { output: {}, model: request.model, tokens: 10, cost: 0.01, toolCall: { id: 'c1', name: 't0_read_diff', arguments: {} } }
      : { output: { verdict: 'accept' }, model: request.model, tokens: 10, cost: 0.01 };
  },
});

const agent = (extra: Record<string, unknown>): CompiledNode => ({ id: 'agent', kind: 'agent', instructions: 'Review.', tools: ['read'], config: { provider: 'azure-openai', model: 'm', promptVersion: '1', responseSchema: shape({ verdict: { type: 'string' } }), policy: POLICY, allowedCapabilities: ['read_diff'], ...extra }, next: 'end' });

async function review(extra: Record<string, unknown>, diffSize: number) {
  const records = new MemoryRecords(); const pin = pinFor('read', READ);
  install(records, [pin]);
  const definition = publish(records, [{ id: 'trigger', kind: 'trigger', config: {}, next: 'agent' }, agent(extra), mcpNode('read', READ, {}, { tool: true }), { id: 'end', kind: 'end', config: {}, next: null }], [pin]);
  await seedRun(records, definition, 'run-1', {});
  const calls = { count: 0 };
  await worker(records, model(calls), { invoke: async () => ({ outcome: 'succeeded', output: { result: 'x'.repeat(diffSize) } }) }).step(TENANT, 'run-1', definition.id, 'agent');
  return (await readRun(records, 'run-1')).data;
}

test('a truncated tool result fails the agent by default', async () => {
  const run = await review({}, 20000);
  expect(run.status).toBe('failed');
  expect(run.history.at(-1)?.detail).toBe('EVIDENCE_TRUNCATED');
});

test('allow-marked lets the agent finish and records that evidence was partial', async () => {
  const run = await review({ onTruncation: 'allow-marked' }, 20000);
  expect(run.status).toBe('running');
  expect(run.outputs['agent']).toMatchObject({ verdict: 'accept', evidenceComplete: false });
});

test('a complete tool result leaves the agent output untouched', async () => {
  const run = await review({}, 100);
  expect(run.outputs['agent']).toEqual({ verdict: 'accept' });
});

test('the approval fact list says when upstream evidence was partial', async () => {
  const records = new MemoryRecords(); const pin = pinFor('act', WRITE);
  install(records, [pin]);
  const definition = publish(records, [
    { id: 'trigger', kind: 'trigger', config: {}, next: 'gate' },
    { id: 'gate', kind: 'approval', config: { timeoutMs: 60000, disclose: ['title'] }, next: 'act' },
    mcpNode('act', WRITE, { title: '$node.agent.verdict' }, { next: 'end' }),
    { id: 'end', kind: 'end', config: {}, next: null },
  ], [pin]);
  await seedRun(records, definition, 'run-1', {}, { outputs: { agent: { verdict: 'accept', evidenceComplete: false } } });
  await worker(records, { complete: async () => { throw new Error('unused'); } }, { invoke: async () => ({ outcome: 'not-dispatched' }) }).step(TENANT, 'run-1', definition.id, 'gate');
  const waiting = (await readRun(records, 'run-1')).data.waiting;
  expect(waiting?.review?.facts).toEqual([{ name: 'title', value: 'accept' }, { name: 'evidence', value: 'partial' }]);
});
