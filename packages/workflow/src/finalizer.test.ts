import { expect, test } from 'vitest';
import { compileGraph, validateGraph, type CapabilityPin, type GraphDraft } from './graph.js';
import { localScheduler } from '../../browser/src/local-scheduler.js';
import type { WorkflowWorker } from './runtime.js';
import { DEFINITION, MemoryRecords, POLICY, TENANT, install, mcpNode, pinFor, publish, readRun, seedRun, shape, unusedModel, worker, type PinSpec } from './worker-harness.test-support.js';

const STATUS: PinSpec = { risk: 'R2', capability: 'set_status', inputSchema: shape({ sha: { type: 'string' }, outcome: { type: 'string' }, run: { type: 'string' } }), outputSchema: shape({ state: { type: 'string' } }) };

const graph = (extra: { edges?: object[]; finalConfig?: Record<string, unknown>; endOutcome?: unknown } = {}): GraphDraft => {
  const pin = pinFor('final', STATUS);
  const node = (id: string, kind: string, config: Record<string, unknown>) => ({ id, kind, title: id, detail: '', x: 0, y: 0, instructions: '', config });
  return { kind: 'graph-v1', nodes: [
    node('start', 'trigger', { mode: 'manual', inputSchema: shape({ head: { type: 'string' } }) }),
    node('final', 'mcp', { installationId: pin.installationId, capability: pin.capability, manifestDigest: pin.manifestDigest, grantId: pin.grantId, target: 'repo', arguments: { sha: '$input.head', outcome: '$run.outcome', run: '$run.id' }, policy: POLICY, ...extra.finalConfig }),
    node('end', 'end', extra.endOutcome === undefined ? {} : { outcome: extra.endOutcome }),
  ], edges: [{ id: 'a', from: 'start', to: 'end' }, ...(extra.edges ?? [{ id: 'f', from: 'start', to: 'final', role: 'finalizer' }])] } as GraphDraft;
};
const pins: readonly CapabilityPin[] = [pinFor('final', STATUS)];
const codes = (draft: GraphDraft): string[] => validateGraph(draft, pins).map((issue) => issue.code);

test('a finalizer edge from the trigger to an effect needs no approval and no flow connection', () => {
  expect(codes(graph())).toEqual([]);
});

test.each([
  ['from a non-trigger', [{ id: 'f', from: 'end', to: 'final', role: 'finalizer' }]],
  ['with a branch', [{ id: 'f', from: 'start', to: 'final', role: 'finalizer', branch: 'true' }]],
  ['twice to one node', [{ id: 'f', from: 'start', to: 'final', role: 'finalizer' }, { id: 'g', from: 'start', to: 'final', role: 'finalizer' }]],
  ['plus a flow edge', [{ id: 'f', from: 'start', to: 'final', role: 'finalizer' }, { id: 'g', from: 'start', to: 'final' }]],
])('a finalizer edge %s is invalid', (_label, edges) => {
  expect(codes(graph({ edges }))).not.toEqual([]);
});

test('a finalizer cannot be an R3 effect because it runs without approval', () => {
  const r3: readonly CapabilityPin[] = [{ ...pinFor('final', STATUS), risk: 'R3' }];
  expect(validateGraph(graph(), r3).map((issue) => issue.code)).toContain('FINALIZER_RISK');
  expect(codes(graph())).not.toContain('FINALIZER_RISK');
});

test('the runtime also refuses to run an R3 finalizer', async () => {
  const { records, calls, w } = await terminal('rejected');
  const pin = pinFor('final', { ...STATUS, risk: 'R3' });
  const published = records.published.get(`${TENANT}:${DEFINITION}`);
  if (!published) throw new Error('definition missing');
  records.published.set(`${TENANT}:${DEFINITION}`, { ...published, definition: { ...published.definition, capabilityPins: [pin] } });
  await w.finalize(TENANT, 'run-1');
  expect(calls).toEqual([]);
  expect((await readRun(records, 'run-1')).data.history.at(-1)).toMatchObject({ kind: 'finalizer', state: 'failed', detail: 'DENIED' });
});

test('finalizer arguments may not read model output', () => {
  const draft = graph(); const node = draft.nodes.find((item) => item.id === 'final')!;
  node.config = { ...node.config, arguments: { sha: '$node.agent.sha', outcome: '$run.outcome', run: '$run.id' } };
  expect(codes(draft)).not.toEqual([]);
});

test('run mappings are only allowed on finalizers', () => {
  const draft = graph(); draft.edges = [{ id: 'a', from: 'start', to: 'final' }, { id: 'b', from: 'final', to: 'end' }];
  expect(codes(draft)).not.toEqual([]);
});

test.each([[undefined, true], ['accepted', true], ['Accepted', false], [5, false]])('end outcome %j is valid: %s', (outcome, valid) => {
  expect(codes(graph({ endOutcome: outcome })).length === 0).toBe(valid);
});

test('compile marks the finalizer and lists it on the trigger', async () => {
  const definition = await compileGraph(DEFINITION, 1, graph(), pins);
  expect(definition.nodes.find((node) => node.id === 'start')?.finalizers).toEqual(['final']);
  expect(definition.nodes.find((node) => node.id === 'final')).toMatchObject({ finalizer: true, next: null });
});

async function terminal(status: 'rejected' | 'completed' | 'failed', patch: Record<string, unknown> = {}, outcome: 'succeeded' | 'unknown-outcome' = 'succeeded') {
  const records = new MemoryRecords(); install(records, [...pins]);
  const final = { ...mcpNode('final', STATUS, { sha: '$input.head', outcome: '$run.outcome', run: '$run.id' }), finalizer: true as const };
  const definition = publish(records, [{ id: 'start', kind: 'trigger', config: {}, next: null, finalizers: ['final'] }, final], [...pins], 'start');
  await seedRun(records, definition, 'run-1', { head: 'abc123' }, { status, ...patch });
  const calls: Record<string, unknown>[] = [];
  const w = worker(records, unusedModel, { invoke: async (_i, _c, args) => { calls.push(args); return outcome === 'succeeded' ? { outcome, output: { state: 'ok' } } : { outcome }; } });
  return { records, calls, w, definition };
}

test('finalize runs the effect once with the run outcome and the trigger input', async () => {
  const { records, calls, w } = await terminal('rejected');
  await w.finalize(TENANT, 'run-1'); await w.finalize(TENANT, 'run-1');
  expect(calls).toEqual([{ sha: 'abc123', outcome: 'rejected', run: 'run-1' }]);
  const run = (await readRun(records, 'run-1')).data;
  expect(run.status).toBe('rejected');
  expect(run.history.filter((event) => event.kind === 'finalizer')).toMatchObject([{ nodeId: 'final', state: 'completed' }]);
});

test('the outcome label set by the end node wins over the status', async () => {
  const { calls, w } = await terminal('completed', { outcomeLabel: 'returned' });
  await w.finalize(TENANT, 'run-1');
  expect(calls[0]).toMatchObject({ outcome: 'returned' });
});

test('a finalizer that fails is recorded but never changes the run status', async () => {
  const { records, w } = await terminal('failed', {}, 'unknown-outcome');
  await w.finalize(TENANT, 'run-1');
  const run = (await readRun(records, 'run-1')).data;
  expect(run.status).toBe('failed');
  expect(run.history.at(-1)).toMatchObject({ kind: 'finalizer', state: 'failed' });
});

test('a run that is not finished is left alone', async () => {
  const { calls, w } = await terminal('completed', { status: 'running' });
  await w.finalize(TENANT, 'run-1');
  expect(calls).toEqual([]);
});

test('the local scheduler finalizes after the run ends, however it ends', async () => {
  const finalized: string[] = [];
  const stub = { step: async () => ({ failed: true }), finalize: async (_tenant: string, runId: string) => { finalized.push(runId); }, expire: async () => ({ failed: true }), summarize: async () => {}, summaryFailed: async () => {}, promote: async () => {} } as unknown as WorkflowWorker;
  const records = new MemoryRecords(); publish(records, [{ id: 'start', kind: 'trigger', config: {}, next: null }], [], 'start');
  const scheduler = localScheduler(stub, records as never);
  await scheduler.start('run-1', TENANT, DEFINITION);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(finalized).toEqual(['run-1']);
});
