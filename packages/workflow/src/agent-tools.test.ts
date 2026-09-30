import { afterEach, expect, test } from 'vitest';
import { observe, resetObservers } from '../../telemetry/src/observe.test-support.js';
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

interface Fixture { store: Store; worker: WorkflowWorker; memory: InMemoryHostedMemoryPort; runId: string; requests: ModelRequest[]; invocations: { capability: string; args: Record<string, unknown> }[]; run(): Promise<WorkflowRecord<WorkflowRun>>; approve(decision: 'approve' | 'reject'): Promise<void>; }
interface Options { route?: 'public' | 'private'; risk?: CapabilityPin['risk']; script: (call: number, request: ModelRequest) => ModelResult | Promise<ModelResult>; outcome?: 'succeeded' | 'unknown-outcome' | 'failed'; agentConfig?: Record<string, unknown>; graph?: (base: GraphDraft) => GraphDraft; pins?: CapabilityPin[]; input?: Record<string, unknown>; memoryTenants?: string[]; }

async function fixture(options: Options): Promise<Fixture> {
  const store = new Store(); const runId = '99999999-9999-4999-8999-999999999999';
  const base: GraphDraft = { kind: 'graph-v1', nodes: [node('start', 'trigger', { mode: 'manual', inputSchema: empty }), agent(options.agentConfig), tool('crm', 'lookup'), node('end', 'end', {})], edges: [flowEdge('start', 'agent'), flowEdge('agent', 'end'), { id: 'tool', from: 'agent', to: 'crm', role: 'tool' }] };
  const draft = options.graph ? options.graph(base) : base;
  const definition = await compileGraph(definitionId, 1, draft, options.pins ?? [pin('crm', 'lookup', options.risk ?? 'R1')]);
  store.definition = { id: definitionId, draftId: definitionId, draftRevision: 1, digest: definition.digest, definition };
  await store.workerWrite(tenant, 'installation', installationId, 0, 'healthy', { route: options.route ?? 'public', endpoint: 'https://example.com/mcp', health: 'healthy', manifest: { version: '1', certified: true, digest: manifestDigest, capabilities: [] } });
  await store.workerWrite(tenant, 'grant', grantId, 0, 'active', {});
  const run: WorkflowRun = { id: runId, tenantId: tenant, ownerId: tenant, stableDefinitionId: definitionId, definitionId, definitionRevision: 1, definitionDigest: definition.digest, inputDigest: 'b'.repeat(64), input: options.input ?? {}, status: 'running', history: [], outputs: {} };
  await store.workerWrite(tenant, 'run', runId, 0, 'running', run);
  const requests: ModelRequest[] = []; const invocations: { capability: string; args: Record<string, unknown> }[] = []; let calls = 0;
  const model: ModelPort = { complete: async (request) => { requests.push(request); calls += 1; return options.script(calls, request); } };
  const mcp: McpPort = { invoke: async (_installation, capability, args) => { invocations.push({ capability, args }); return options.outcome === 'unknown-outcome' ? { outcome: 'unknown-outcome' } : options.outcome === 'failed' ? { outcome: 'failed' } : { outcome: 'succeeded', output: { result: `found:${String(args['query'])}` } }; } };
  const memory = new InMemoryHostedMemoryPort(options.memoryTenants ?? [tenant]);
  const worker = new WorkflowWorker(store as unknown as WorkflowStore, model, mcp, memory);
  const read = async () => (await store.workerRead<WorkflowRun>(tenant, 'run', runId))!;
  const approve = async (decision: 'approve' | 'reject') => {
    const current = await read(); const waiting = current.data.waiting!; const data: WorkflowRun = { ...current.data, status: decision === 'approve' ? 'running' : 'failed', history: [...current.data.history, { nodeId: waiting.nodeId, kind: 'approval', state: decision === 'approve' ? 'completed' : 'failed', at: new Date().toISOString(), detail: decision, bindingDigest: waiting.bindingDigest }] };
    delete data.waiting; await store.workerWrite(tenant, 'run', runId, current.version, data.status, data);
  };
  return { store, worker, memory, runId, requests, invocations, run: read, approve };
}

afterEach(resetObservers);

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

test('a tool approval counts one tool-kind request and repeats nothing while it waits', async () => {
  const { points, events } = observe();
  const f = await fixture({ risk: 'R2', script: (n) => n === 1 ? call('c1', 't0_lookup', { query: 'acme' }) : answer('done') });
  const step = await start(f);
  await step(); await step();
  expect((await points('workflow.approvals.requested')).map((point) => ({ attributes: point.attributes, value: point.value }))).toEqual([{ attributes: { tenant_id: expect.any(String), kind: 'tool' }, value: 1 }]);
  expect(events('approval.requested')).toEqual([expect.objectContaining({ kind: 'tool', capability: 'lookup', node_id: 'agent' })]);
});

test('a tool approval records when it was requested and every successful model call is counted', async () => {
  const f = await fixture({ risk: 'R2', script: (n) => n === 1 ? call('c1', 't0_lookup', { query: 'acme' }) : answer('done') });
  const step = await start(f);
  await step();
  const waiting = (await f.run()).data;
  expect(Date.parse(waiting.waiting?.requestedAt ?? '')).toBeLessThanOrEqual(Date.parse(waiting.waiting?.expiresAt ?? ''));
  expect(waiting.usage).toEqual({ tokens: 10, cost: 0.01, modelCalls: 1 });
  await f.approve('approve'); await step();
  expect((await f.run()).data.usage).toEqual({ tokens: 20, cost: 0.02, modelCalls: 2 });
});

test('a model that reports no usage cannot poison the run usage or fail the attempt write', async () => {
  const f = await fixture({ script: () => ({ ...answer('done'), tokens: Infinity, cost: Infinity }) });
  const step = await start(f);
  expect(await step()).toEqual({ failed: true });
  const run = await f.run();
  expect(run.data.usage).toEqual({ tokens: 0, cost: 0, modelCalls: 1 });
  expect(run.data.history.some((item) => item.state === 'attempted' && item.detail?.endsWith(':succeeded'))).toBe(true);
});

test('a failed model attempt adds nothing to the run usage', async () => {
  const f = await fixture({ script: () => { throw new Error('unavailable'); } });
  const step = await start(f);
  expect(await step()).toEqual({ failed: true });
  expect((await f.run()).data.usage).toBeUndefined();
});

test('every model request carries its feature, run, node and attempt number', async () => {
  const f = await fixture({ script: (n) => n === 1 ? call('c1', 't0_lookup', { query: 'acme' }) : answer('done') });
  const step = await start(f);
  await step();
  expect(f.requests.map((request) => request.telemetry)).toEqual([{ feature: 'workflow', runId: f.runId, nodeId: 'agent', attempt: 1 }, { feature: 'workflow', runId: f.runId, nodeId: 'agent', attempt: 1 }]);
});

test('a public tool call records its span, one duration point with the port outcome and one mcp.call event, and leaks no arguments or results', async () => {
  const { spans, points, events, everything } = observe();
  const f = await fixture({ script: (n) => n === 1 ? call('c1', 't0_lookup', { query: 'MARKER_ARGUMENT_2b7e' }) : answer('done') });
  const step = await start(f);
  await step();
  const duration = await points('mcp.tool.call.duration');
  expect(duration.map((point) => ({ attributes: point.attributes, count: (point.value as { count: number }).count }))).toEqual([{ attributes: { tenant_id: tenant, capability: 'lookup', outcome: 'succeeded', route: 'public' }, count: 1 }]);
  const [effect] = await f.store.workerList<EffectData>(tenant, 'effect');
  expect(events('mcp.call')).toEqual([{ event: 'mcp.call', level: 'info', at: expect.any(String) as string, tenant_id: tenant, run_id: f.runId, node_id: 'crm', capability: 'lookup', route: 'public', outcome: 'succeeded', duration_s: expect.any(Number) as number, effect_id: effect?.id }]);
  expect((await spans()).filter((span) => span.name === 'mcp.call').map((span) => ({ attributes: span.attributes, status: span.status.code }))).toEqual([{ attributes: { tenant_id: tenant, capability: 'lookup', route: 'public', 'workflow.run_id': f.runId, 'workflow.node_id': 'crm' }, status: 0 }]);
  const serialized = await everything();
  expect(serialized).toContain('mcp.tool.call.duration');
  expect(serialized).not.toContain('MARKER_ARGUMENT_2b7e'); expect(serialized).not.toContain('found:');
});

test('a failed public tool call records its outcome and marks the span as an error', async () => {
  const { spans, points, events } = observe();
  const f = await fixture({ outcome: 'failed', script: () => call('c1', 't0_lookup', { query: 'acme' }) });
  const step = await start(f);
  expect(await step()).toEqual({ failed: true });
  expect((await points('mcp.tool.call.duration')).map((point) => point.attributes['outcome'])).toEqual(['failed']);
  expect(events('mcp.call')).toEqual([expect.objectContaining({ outcome: 'failed' })]);
  expect((await spans()).find((span) => span.name === 'mcp.call')?.status).toEqual({ code: 2, message: 'failed' });
});

test('a capability queued to a private connector emits a queued mcp.call event and no duration point', async () => {
  const { points, events } = observe();
  const f = await fixture({ route: 'private', script: (n) => n === 1 ? call('c1', 't0_lookup', { query: 'acme' }) : answer('done') });
  const step = await start(f);
  expect(await step()).toMatchObject({ waiting: 'connector' });
  const [effect] = await f.store.workerList<EffectData>(tenant, 'effect');
  expect(events('mcp.call')).toEqual([{ event: 'mcp.call', level: 'info', at: expect.any(String) as string, tenant_id: tenant, run_id: f.runId, node_id: 'crm', capability: 'lookup', route: 'private', outcome: 'queued', effect_id: effect?.id }]);
  expect(await points('mcp.tool.call.duration')).toEqual([]);
  expect(f.invocations).toHaveLength(0);
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

const recall = node('recall', 'memory', { limit: 3, maxChars: 500, policy: { milliseconds: 30000, attempts: 1, tokens: 0, cost: 0, toolRounds: 0, effects: 0 } });
const attached = (from: string, to: string) => ({ id: `${from}-${to}-tool`, from, to, role: 'tool' as const });
const withMemory = (base: GraphDraft): GraphDraft => ({ ...base, nodes: [...base.nodes, recall], edges: [...base.edges, attached('agent', 'recall')] });
const memoryOnly = (base: GraphDraft): GraphDraft => ({ ...base, nodes: [...base.nodes.filter((item) => item.id !== 'crm'), recall], edges: [...base.edges.filter((item) => item.role !== 'tool'), attached('agent', 'recall')] });
const roomy = { policy: { ...policy, toolRounds: 5, effects: 5 } };
const noteInput = { note: 'prefers email' };
const toolContents = async (f: Fixture) => (await f.run()).data.agents?.['agent']?.transcript.filter((entry) => entry.role === 'tool').map((entry) => JSON.parse(entry.content) as Record<string, unknown>) ?? [];

async function seedMemory(f: Fixture): Promise<void> {
  const sourceDigest = 'c'.repeat(64); const id = '12345678-1234-4234-8234-123456789012';
  await f.memory.upsert(`tenant-${tenant}`, { id, text: 'Customer prefers email', metadata: { stableDefinitionId: definitionId, definitionId, producingRevision: 1, type: 'task-fact', sourceId: 'input:earlier', sourceDigest, state: 'promoted', expiresAt: new Date(Date.now() + 86400000).toISOString() } });
  await f.store.workerWrite(tenant, 'memory-item', id, 0, 'promoted', { stableDefinitionId: definitionId, definitionId, producingRevision: 1, type: 'task-fact', sourceId: 'input:earlier', sourceDigest, sourceKind: 'input', fingerprint: 'd'.repeat(64), vectorState: 'ready' });
}

test('memory_search returns provenance-bearing promoted items inside one agent step', async () => {
  const f = await fixture({ graph: memoryOnly, script: (n) => n === 1 ? call('c1', 'memory_search', { query: 'email' }) : answer('done') });
  await seedMemory(f);
  const step = await start(f);
  expect(await step()).toEqual({ next: 'end' });
  expect(f.requests[0]?.tools?.map((item) => item.name)).toEqual(['memory_search', 'memory_save']);
  const [content] = await toolContents(f);
  expect(content).toMatchObject({ status: 'success', items: [{ text: 'Customer prefers email', sourceId: 'input:earlier', sourceDigest: 'c'.repeat(64) }] });
  const run = await f.run();
  expect(run.data.agents?.['agent']).toMatchObject({ rounds: 1, effects: 0 });
  expect(run.data.history.map((item) => `${item.nodeId}:${item.kind}:${item.state}:${item.detail ?? ''}`)).toContain('recall:memory:completed:tool:1');
  expect((await f.store.workerList(tenant, 'memory-retrieval'))).toHaveLength(1);
  expect(f.invocations).toHaveLength(0);
});

test('memory_search with an empty query or a wrong argument type returns INVALID_ARGUMENTS', async () => {
  const f = await fixture({ graph: memoryOnly, script: (n) => n === 1 ? call('c1', 'memory_search', { query: '   ' }) : n === 2 ? call('c2', 'memory_search', { query: 4 }) : answer('done') });
  const step = await start(f);
  expect(await step()).toEqual({ next: 'end' });
  expect(await toolContents(f)).toEqual([{ error: 'INVALID_ARGUMENTS' }, { error: 'INVALID_ARGUMENTS' }]);
});

test('memory_save stages a pending proposal from the run input and counts as an effect', async () => {
  const f = await fixture({ graph: memoryOnly, input: noteInput, script: (n) => n === 1 ? call('c1', 'memory_save', { type: 'task-fact', text: 'Customer prefers email', excerpt: 'prefers email' }) : answer('done') });
  const step = await start(f);
  expect(await step()).toEqual({ next: 'end' });
  const items = await f.store.workerList<{ sourceId: string; sourceDigest: string }>(tenant, 'memory-item');
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ state: 'pending', data: { sourceId: `input:${f.runId}`, sourceDigest: 'b'.repeat(64) } });
  expect(f.memory.items.get(`tenant-${tenant}:${items[0]!.id}`)?.metadata.state).toBe('pending');
  expect(await toolContents(f)).toEqual([{ saved: true, state: 'pending', id: items[0]!.id }]);
  expect((await f.run()).data.agents?.['agent']).toMatchObject({ rounds: 1, effects: 1 });
  expect(await step()).toEqual({ next: 'end' });
  expect(await f.store.workerList(tenant, 'memory-item')).toHaveLength(1);
});

test('memory_save rejects uncited excerpts, secrets and unknown fields without staging anything pending', async () => {
  const f = await fixture({ graph: memoryOnly, input: noteInput, agentConfig: roomy, script: (n) => n === 1 ? call('c1', 'memory_save', { type: 'task-fact', text: 'Customer likes phone', excerpt: 'likes phone' }) : n === 2 ? call('c2', 'memory_save', { type: 'task-fact', text: 'password: hunter2', excerpt: 'prefers email' }) : n === 3 ? call('c3', 'memory_save', { type: 'task-fact', text: 'ok', excerpt: 'prefers email', sourceId: 'input:x' }) : n === 4 ? call('c4', 'memory_save', { type: 'inferred', text: 'ok', excerpt: 'prefers email' }) : answer('done') });
  const step = await start(f);
  expect(await step()).toEqual({ next: 'end' });
  expect(await toolContents(f)).toEqual(Array.from({ length: 4 }, () => ({ error: 'INVALID_ARGUMENTS' })));
  expect((await f.store.workerList(tenant, 'memory-item')).filter((item) => item.state === 'pending')).toHaveLength(0);
  expect((await f.run()).data.agents?.['agent']?.effects).toBe(0);
});

test('memory tools report MEMORY_UNAVAILABLE when operational memory is disabled for the tenant', async () => {
  const f = await fixture({ graph: memoryOnly, input: noteInput, memoryTenants: ['00000000-0000-4000-8000-000000000000'], script: (n) => n === 1 ? call('c1', 'memory_search', { query: 'email' }) : n === 2 ? call('c2', 'memory_save', { type: 'task-fact', text: 'ok', excerpt: 'prefers email' }) : answer('done') });
  const step = await start(f);
  expect(await step()).toEqual({ next: 'end' });
  expect(await toolContents(f)).toEqual([{ error: 'MEMORY_UNAVAILABLE' }, { error: 'MEMORY_UNAVAILABLE' }]);
});

test('memory_save past the external-effect limit fails the run', async () => {
  const f = await fixture({ graph: memoryOnly, input: noteInput, agentConfig: { policy: { ...policy, toolRounds: 5, effects: 1 } }, script: () => call('c', 'memory_save', { type: 'task-fact', text: 'Customer prefers email', excerpt: 'prefers email' }) });
  const step = await start(f);
  expect(await step()).toEqual({ failed: true });
  expect(f.requests.at(-1)?.toolChoice).toBe('none');
  expect((await f.run()).state).toBe('failed');
});

test('an agent drives three MCP capabilities and memory through separate tool calls in one step', async () => {
  const many = (base: GraphDraft): GraphDraft => withMemory({ ...base, nodes: [...base.nodes, tool('files', 'files.read'), tool('notes', 'notes')], edges: [...base.edges, attached('agent', 'files'), attached('agent', 'notes')] });
  const pins = [pin('crm', 'lookup', 'R1'), pin('files', 'files.read', 'R1'), pin('notes', 'notes', 'R1')];
  const f = await fixture({ graph: many, pins, input: noteInput, agentConfig: roomy, script: (n) => n === 1 ? call('c1', 't0_lookup', { query: 'a' }) : n === 2 ? call('c2', 't1_files_read', { query: 'b' }) : n === 3 ? call('c3', 't2_notes', { query: 'c' }) : n === 4 ? call('c4', 'memory_save', { type: 'task-fact', text: 'Customer prefers email', excerpt: 'prefers email' }) : answer('done') });
  const step = await start(f);
  expect(await step()).toEqual({ next: 'end' });
  expect(f.requests[0]?.tools?.map((item) => item.name)).toEqual(['t0_lookup', 't1_files_read', 't2_notes', 'memory_search', 'memory_save']);
  expect(f.invocations.map((item) => item.capability)).toEqual(['lookup', 'files.read', 'notes']);
  expect((await f.run()).data.agents?.['agent']).toMatchObject({ rounds: 4, effects: 4 });
  expect((await f.run()).data.outputs['agent']).toEqual({ result: 'done' });
});

test('three MCPs on one agent keep independent approval bindings per call', async () => {
  const many = (base: GraphDraft): GraphDraft => ({ ...base, nodes: [...base.nodes, tool('files', 'files.read')], edges: [...base.edges, attached('agent', 'files')] });
  const f = await fixture({ graph: many, risk: 'R2', pins: [pin('crm', 'lookup', 'R2'), pin('files', 'files.read', 'R1')], agentConfig: roomy, script: (n) => n === 1 ? call('c1', 't1_files_read', { query: 'b' }) : n === 2 ? call('c2', 't0_lookup', { query: 'a' }) : answer('done') });
  const step = await start(f);
  expect(await step()).toMatchObject({ waiting: 'approval' });
  expect(f.invocations.map((item) => item.capability)).toEqual(['files.read']);
  await f.approve('approve');
  expect(await step()).toEqual({ next: 'end' });
  expect(f.invocations.map((item) => item.capability)).toEqual(['files.read', 'lookup']);
});
