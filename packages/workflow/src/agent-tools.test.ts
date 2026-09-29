import { expect, test } from 'vitest';
import { InMemoryHostedMemoryPort } from './memory.js';
import { compileGraph, type CapabilityPin, type GraphDraft, type GraphNode, type WorkflowDefinition } from './graph.js';
import { WorkflowWorker, type EffectData, type McpPort, type ModelPort, type ModelRequest, type ModelResult } from './runtime.js';
import type { WorkflowRun } from './service.js';
import type { RecordKind, WorkflowRecord, WorkflowStore } from './sql.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const installationId = '66666666-6666-4666-8666-666666666666';
const grantId = '77777777-7777-4777-8777-777777777777';
const definitionId = '88888888-8888-4888-8888-888888888888';
const manifestDigest = 'a'.repeat(64);
const result = { type: 'object' as const, properties: { result: { type: 'string' as const } }, required: ['result'], additionalProperties: false as const };
const query = { type: 'object' as const, properties: { query: { type: 'string' as const } }, required: ['query'], additionalProperties: false as const };
const empty = { type: 'object' as const, properties: {}, required: [], additionalProperties: false as const };
const flag = { type: 'object' as const, properties: { flag: { type: 'boolean' as const } }, required: ['flag'], additionalProperties: false as const };
const policy = { milliseconds: 60000, attempts: 1, tokens: 100000, cost: 100, toolRounds: 2, effects: 2 };
const node = (id: string, kind: string, config: Record<string, unknown>): GraphNode => ({ id, kind, title: id, detail: '', x: 1, y: 1, instructions: kind === 'agent' ? 'Act.' : '', config });
const agent = (overrides: Record<string, unknown> = {}): GraphNode => node('agent', 'agent', { provider: 'azure-openai', model: 'gpt-4.1', promptVersion: '1', responseSchema: result, policy, ...overrides });
const tool = (id: string, capability: string): GraphNode => node(id, 'mcp', { installationId, capability, manifestDigest, grantId, target: 'crm', arguments: {}, policy });
const pin = (nodeId: string, capability: string, risk: CapabilityPin['risk']): CapabilityPin => ({ nodeId, installationId, capability, manifestDigest, grantId, risk, inputSchema: query, outputSchema: result });
const flowEdge = (from: string, to: string, branch?: 'true' | 'false') => ({ id: `${from}-${to}-${branch ?? ''}`, from, to, ...(branch ? { branch } : {}) });

class Store {
  readonly records = new Map<string, WorkflowRecord<unknown>>(); definition?: { id: string; draftId: string; draftRevision: number; digest: string; definition: WorkflowDefinition };
  private key(kind: RecordKind, id: string) { return `${kind}:${id}`; }
  async workerRead<T>(_tenant: string, kind: RecordKind, id: string) { return this.records.get(this.key(kind, id)) as WorkflowRecord<T> | undefined; }
  async workerList<T>(_tenant: string, kind: RecordKind) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${kind}:`)).map(([, value]) => value as WorkflowRecord<T>); }
  async workerWrite<T>(_tenant: string, kind: RecordKind, id: string, expectedVersion: number, state: string, data: T) {
    const existing = this.records.get(this.key(kind, id)); if ((existing?.version ?? 0) !== expectedVersion) throw Object.assign(new Error('STALE'), { code: 'STALE' });
    const value = { id, kind, version: expectedVersion + 1, state, data }; this.records.set(this.key(kind, id), value as WorkflowRecord); return value;
  }
  async workerDefinition() { return this.definition; }
}

interface Fixture { store: Store; worker: WorkflowWorker; runId: string; requests: ModelRequest[]; invocations: { capability: string; args: Record<string, unknown> }[]; run(): Promise<WorkflowRecord<WorkflowRun>>; approve(decision: 'approve' | 'reject'): Promise<void>; }
interface Options { risk?: CapabilityPin['risk']; script: (call: number, request: ModelRequest) => ModelResult | Promise<ModelResult>; outcome?: 'succeeded' | 'unknown-outcome' | 'failed'; agentConfig?: Record<string, unknown>; graph?: (base: GraphDraft) => GraphDraft; input?: Record<string, unknown>; }

async function fixture(options: Options): Promise<Fixture> {
  const store = new Store(); const runId = '99999999-9999-4999-8999-999999999999';
  const base: GraphDraft = { kind: 'graph-v1', nodes: [node('start', 'trigger', { mode: 'manual', inputSchema: empty }), agent(options.agentConfig), tool('crm', 'lookup'), node('end', 'end', {})], edges: [flowEdge('start', 'agent'), flowEdge('agent', 'end'), { id: 'tool', from: 'agent', to: 'crm', role: 'tool' }] };
  const draft = options.graph ? options.graph(base) : base;
  const definition = await compileGraph(definitionId, 1, draft, [pin('crm', 'lookup', options.risk ?? 'R1')]);
  store.definition = { id: definitionId, draftId: definitionId, draftRevision: 1, digest: definition.digest, definition };
  await store.workerWrite(tenant, 'installation', installationId, 0, 'healthy', { route: 'public', endpoint: 'https://example.com/mcp', health: 'healthy', manifest: { version: '1', certified: true, digest: manifestDigest, capabilities: [] } });
  await store.workerWrite(tenant, 'grant', grantId, 0, 'active', {});
  const run: WorkflowRun = { id: runId, tenantId: tenant, ownerId: tenant, stableDefinitionId: definitionId, definitionId, definitionRevision: 1, definitionDigest: definition.digest, inputDigest: 'b'.repeat(64), input: options.input ?? {}, status: 'running', history: [], outputs: {} };
  await store.workerWrite(tenant, 'run', runId, 0, 'running', run);
  const requests: ModelRequest[] = []; const invocations: { capability: string; args: Record<string, unknown> }[] = []; let calls = 0;
  const model: ModelPort = { complete: async (request) => { requests.push(request); calls += 1; return options.script(calls, request); } };
  const mcp: McpPort = { invoke: async (_installation, capability, args) => { invocations.push({ capability, args }); return options.outcome === 'unknown-outcome' ? { outcome: 'unknown-outcome' } : options.outcome === 'failed' ? { outcome: 'failed' } : { outcome: 'succeeded', output: { result: `found:${String(args['query'])}` } }; } };
  const worker = new WorkflowWorker(store as unknown as WorkflowStore, model, mcp, new InMemoryHostedMemoryPort([tenant]));
  const read = async () => (await store.workerRead<WorkflowRun>(tenant, 'run', runId))!;
  const approve = async (decision: 'approve' | 'reject') => {
    const current = await read(); const waiting = current.data.waiting!; const data: WorkflowRun = { ...current.data, status: decision === 'approve' ? 'running' : 'failed', history: [...current.data.history, { nodeId: waiting.nodeId, kind: 'approval', state: decision === 'approve' ? 'completed' : 'failed', at: new Date().toISOString(), detail: decision, bindingDigest: waiting.bindingDigest }] };
    delete data.waiting; await store.workerWrite(tenant, 'run', runId, current.version, data.status, data);
  };
  return { store, worker, runId, requests, invocations, run: read, approve };
}

const call = (id: string, name: string, args: Record<string, unknown>): ModelResult => ({ output: {}, model: 'gpt-4.1', tokens: 10, cost: 0.01, toolCall: { id, name, arguments: args } });
const answer = (text: string): ModelResult => ({ output: { result: text }, model: 'gpt-4.1', tokens: 10, cost: 0.01 });
const start = async (f: Fixture) => { await f.worker.step(tenant, f.runId, definitionId, 'start'); return () => f.worker.step(tenant, f.runId, definitionId, 'agent'); };

test('an R1 tool call runs inside one agent step and the agent continues to its flow successor', async () => {
  const f = await fixture({ script: (n) => n === 1 ? call('c1', 't0_lookup', { query: 'acme' }) : answer('done') });
  const step = await start(f);
  expect(await step()).toEqual({ next: 'end' });
  expect(f.invocations).toEqual([{ capability: 'lookup', args: { query: 'acme' } }]);
  expect(f.requests[0]?.tools).toMatchObject([{ name: 't0_lookup' }]);
  expect(f.requests[1]?.transcript).toMatchObject([{ role: 'assistant', call: { id: 'c1' } }, { role: 'tool', callId: 'c1', content: JSON.stringify({ result: 'found:acme' }) }]);
  const run = await f.run();
  expect(run.data.outputs['agent']).toEqual({ result: 'done' });
  expect(run.data.history.map((item) => `${item.nodeId}:${item.kind}:${item.state}`)).toEqual(['start:trigger:completed', 'agent:agent:attempted', 'crm:mcp:completed', 'agent:agent:attempted', 'agent:agent:completed']);
  expect(await step()).toEqual({ next: 'end' });
  expect(f.invocations).toHaveLength(1);
});

test('an R2 tool call pauses for approval, resumes from the stored transcript and invokes exactly once', async () => {
  const f = await fixture({ risk: 'R2', script: (n) => n === 1 ? call('c1', 't0_lookup', { query: 'acme' }) : answer('done') });
  const step = await start(f);
  expect(await step()).toMatchObject({ waiting: 'approval' });
  expect((await f.run()).state).toBe('waiting-approval');
  expect((await f.run()).data.waiting).toMatchObject({ nodeId: 'agent', review: { capability: 'lookup', target: 'crm' } });
  expect(await step()).toMatchObject({ waiting: 'approval' });
  expect(f.invocations).toHaveLength(0); expect(f.requests).toHaveLength(1);
  await f.approve('approve');
  expect(await step()).toEqual({ next: 'end' });
  expect(f.invocations).toHaveLength(1); expect(f.requests).toHaveLength(2);
  expect((await f.run()).data.agents?.['agent']?.pausedAt).toBeUndefined();
  expect(await step()).toEqual({ next: 'end' }); expect(f.invocations).toHaveLength(1);
});

test('a rejected tool approval fails the run and never invokes the tool', async () => {
  const f = await fixture({ risk: 'R2', script: () => call('c1', 't0_lookup', { query: 'acme' }) });
  const step = await start(f); await step(); await f.approve('reject');
  expect(await step()).toEqual({ failed: true });
  expect(f.invocations).toHaveLength(0); expect((await f.run()).state).toBe('failed');
});

test('an approval for one call does not authorize a different call', async () => {
  const f = await fixture({ risk: 'R2', script: (n) => n === 1 ? call('c1', 't0_lookup', { query: 'a' }) : n === 2 ? call('c2', 't0_lookup', { query: 'b' }) : answer('done') });
  const step = await start(f); await step(); await f.approve('approve');
  expect(await step()).toMatchObject({ waiting: 'approval' });
  expect(f.invocations).toHaveLength(1);
  await f.approve('approve');
  expect(await step()).toEqual({ next: 'end' });
  expect(f.invocations.map((item) => item.args['query'])).toEqual(['a', 'b']);
});

test('a model that keeps calling tools fails at the round limit', async () => {
  const f = await fixture({ script: (n) => call(`c${n}`, 't0_lookup', { query: String(n) }), agentConfig: { policy: { ...policy, toolRounds: 2, effects: 5 } } });
  const step = await start(f);
  expect(await step()).toEqual({ failed: true });
  expect(f.invocations).toHaveLength(2);
  expect(f.requests.at(-1)?.toolChoice).toBe('none');
  expect((await f.run()).state).toBe('failed');
});

test('an unknown-outcome tool call stops the run for reconciliation and is never retried', async () => {
  const f = await fixture({ outcome: 'unknown-outcome', script: (n) => n === 1 ? call('c1', 't0_lookup', { query: 'acme' }) : answer('done') });
  const step = await start(f);
  expect(await step()).toEqual({ failed: true });
  expect((await f.run()).state).toBe('unknown-outcome');
  expect(await step()).toEqual({ failed: true });
  expect(f.invocations).toHaveLength(1);
  expect((await f.store.workerList<EffectData>(tenant, 'effect'))[0]?.data.agentId).toBe('agent');
});

test('invalid tool arguments and unknown tool names are returned to the model as tool errors', async () => {
  const f = await fixture({ script: (n) => n === 1 ? call('c1', 't0_lookup', { query: 7 }) : n === 2 ? call('c2', 'ghost', {}) : answer('done') });
  const step = await start(f);
  expect(await step()).toEqual({ next: 'end' });
  expect(f.invocations).toHaveLength(0);
  expect(f.requests[2]?.transcript?.filter((entry) => entry.role === 'tool').map((entry) => entry.content)).toEqual([JSON.stringify({ error: 'INVALID_ARGUMENTS' }), JSON.stringify({ error: 'UNKNOWN_TOOL' })]);
});

test('a failed tool call fails the run', async () => {
  const f = await fixture({ outcome: 'failed', script: () => call('c1', 't0_lookup', { query: 'acme' }) });
  const step = await start(f);
  expect(await step()).toEqual({ failed: true });
  expect((await f.run()).state).toBe('failed');
});

test('a tool node is never a runnable step', async () => {
  const f = await fixture({ script: () => answer('done') });
  expect(await f.worker.step(tenant, f.runId, definitionId, 'crm')).toEqual({ failed: true });
});

test('a tool call from an agent without tools is refused as a limit violation', async () => {
  const f = await fixture({ graph: (base) => ({ ...base, nodes: base.nodes.filter((item) => item.id !== 'crm'), edges: base.edges.filter((item) => item.role !== 'tool') }), script: () => call('c1', 't0_lookup', { query: 'x' }) });
  const step = await start(f);
  expect(await step()).toEqual({ failed: true });
  expect(f.requests[0]?.tools).toBeUndefined();
});

test('an unconnected condition branch completes the run', async () => {
  const f = await fixture({ input: { flag: false }, graph: () => ({ kind: 'graph-v1', nodes: [node('start', 'trigger', { mode: 'manual', inputSchema: flag }), node('check', 'condition', { source: 'input', field: 'flag', equals: true }), node('end', 'end', {})], edges: [flowEdge('start', 'check'), flowEdge('check', 'end', 'true')] }), script: () => answer('unused') });
  expect(await f.worker.step(tenant, f.runId, definitionId, 'start')).toEqual({ next: 'check' });
  expect(await f.worker.step(tenant, f.runId, definitionId, 'check')).toEqual({ completed: true });
  expect((await f.run()).state).toBe('completed');
});
