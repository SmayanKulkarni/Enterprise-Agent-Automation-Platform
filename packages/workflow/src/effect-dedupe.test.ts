import { expect, test } from 'vitest';
import { validateGraph, type CapabilityPin, type GraphDraft, type NodePolicy } from './graph.js';
import { MemoryRecords, POLICY, TENANT, install, mcpNode, pinFor, publish, readRun, seedRun, shape, worker, unusedModel, type PinSpec } from './worker-harness.test-support.js';

const CREATE: PinSpec = { risk: 'R1', capability: 'create_issue', inputSchema: shape({ title: { type: 'string' }, pr: { type: 'number' } }), outputSchema: shape({ url: { type: 'string' } }) };

async function twoRuns(prs: [number, number], dedupeKey: unknown = ['pr']) {
  const records = new MemoryRecords(); const pin = pinFor('act', CREATE); install(records, [pin]);
  const definition = publish(records, [
    { id: 'trigger', kind: 'trigger', config: {}, next: 'act' },
    { ...mcpNode('act', CREATE, { title: '$input.title', pr: '$input.pr' }, { next: 'end' }), config: { ...mcpNode('act', CREATE, {}).config, arguments: { title: '$input.title', pr: '$input.pr' }, dedupeKey } },
    { id: 'end', kind: 'end', config: {}, next: null },
  ], [pin]);
  let invocations = 0;
  const mcp = { invoke: async () => { invocations += 1; return { outcome: 'succeeded' as const, output: { url: `issue-${invocations}` } }; } };
  const run = async (id: string, title: string, pr: number) => { await seedRun(records, definition, id, { title, pr }); await worker(records, unusedModel, mcp).step(TENANT, id, definition.id, 'act'); return (await readRun(records, id)).data; };
  return { first: await run('run-a', 'first', prs[0]), second: await run('run-b', 'second', prs[1]), invocations: () => invocations };
}

test('a second run for the same natural key reuses the first result instead of sending again', async () => {
  const { first, second, invocations } = await twoRuns([7, 7]);
  expect(invocations()).toBe(1);
  expect(second.outputs['act']).toEqual(first.outputs['act']);
  expect(second.history.at(-1)?.detail).toMatch(/^deduplicated:run-a$/u);
});

test('a different natural key sends again', async () => {
  const { second, invocations } = await twoRuns([7, 8]);
  expect(invocations()).toBe(2);
  expect(second.outputs['act']).toEqual({ url: 'issue-2' });
});

test('without a dedupe key every run sends', async () => {
  const { invocations } = await twoRuns([7, 7], null);
  expect(invocations()).toBe(2);
});

const draft = (dedupeKey: unknown): GraphDraft => {
  const policy: NodePolicy = POLICY;
  const pin: CapabilityPin = pinFor('act', CREATE);
  return { kind: 'graph-v1', nodes: [
    { id: 'start', kind: 'trigger', title: 's', detail: '', x: 0, y: 0, instructions: '', config: { mode: 'manual', inputSchema: shape({ title: { type: 'string' }, pr: { type: 'number' } }) } },
    { id: 'act', kind: 'mcp', title: 'a', detail: '', x: 0, y: 0, instructions: '', config: { installationId: pin.installationId, capability: pin.capability, manifestDigest: pin.manifestDigest, grantId: pin.grantId, target: 'repo', arguments: { title: '$input.title', pr: '$input.pr' }, policy, ...(dedupeKey === undefined ? {} : { dedupeKey }) } },
    { id: 'end', kind: 'end', title: 'e', detail: '', x: 0, y: 0, instructions: '', config: {} },
  ], edges: [{ id: 'a', from: 'start', to: 'act' }, { id: 'b', from: 'act', to: 'end' }] };
};
const codes = (dedupeKey: unknown): string[] => validateGraph(draft(dedupeKey), [pinFor('act', CREATE)]).map((issue) => issue.code);

test.each([[undefined, true], [['pr'], true], [['pr', 'title'], true], [[], false], [['missing'], false], [['pr', 'pr'], false], ['pr', false]])('dedupeKey %j is valid: %s', (dedupeKey, valid) => {
  expect(codes(dedupeKey).includes('UNGRANTED_CAPABILITY')).toBe(!valid);
});
