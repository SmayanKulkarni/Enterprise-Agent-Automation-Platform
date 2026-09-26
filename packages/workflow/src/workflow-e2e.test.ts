import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { BrowserV1Transport, ClerkSessionAdapter, type BrowserCommand } from '../../browser/src/index.js';
import { workflowCommandHandlers } from '../../browser/src/workflow-commands.js';
import { decodeContract, descriptorFor, digest, tenantId, type ContractEnvelope } from '../../contracts/src/index.js';
import { IdentityStore, type ExecutionContext } from '../../identity/src/index.js';
import type { StudioStore, StudioStoredDraft, StudioRunEvidence, CommandReceipt as StudioReceipt } from '../../lifecycle/src/studio-sql.js';
import type { StudioDraft } from '../../lifecycle/src/studio.js';
import { WorkflowWorker, type EffectData } from './runtime.js';
import { InMemoryHostedMemoryPort } from './memory.js';
import type { MemoryItem } from './memory.js';
import { WorkflowService, type Installation, type WorkflowRun } from './service.js';
import type { GraphDraft, CapabilityPin, WorkflowDefinition } from './graph.js';
import type { WorkflowStore, WorkflowRecord, RecordKind, PublishedDefinition } from './sql.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const otherTenant = '22222222-2222-4222-8222-222222222222';
const editor = '33333333-3333-4333-8333-333333333333';
const admin = '44444444-4444-4444-8444-444444444444';
const draftId = '55555555-5555-4555-8555-555555555555';
const installationId = '66666666-6666-4666-8666-666666666666';
const schema = { type: 'object' as const, properties: { result: { type: 'string' as const } }, required: ['result'], additionalProperties: false as const };
const empty = { type: 'object' as const, properties: {}, required: [], additionalProperties: false as const };
const policy = { milliseconds: 30000, attempts: 1, tokens: 1000, cost: 1, toolRounds: 1, effects: 1 };
const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };

class MemoryStudio implements StudioStore {
  private readonly drafts = new Map<string, StudioStoredDraft<StudioDraft | GraphDraft>>();
  private readonly commands = new Map<string, { id: string; digest: string; saved: StudioStoredDraft<StudioDraft | GraphDraft> }>();
  readonly checks = new Map<string, StudioRunEvidence[]>();
  async create(context: ExecutionContext, id: string, draft: StudioDraft | GraphDraft, key?: string) { const valueDigest = await digest(draft); const receiptKey = `${context.tenantId}:${key}`; const previous = key ? this.commands.get(receiptKey) : undefined; if (previous) { if (previous.id !== id || previous.digest !== valueDigest) fail('CONFLICT'); return previous.saved; } if (this.drafts.has(id)) fail('CONFLICT'); const saved = { id, tenantId: String(context.tenantId), revision: 1, state: 'draft' as const, digest: valueDigest, author: context.userId, draft, createdAt: new Date().toISOString() }; this.drafts.set(id, saved); if (key) this.commands.set(receiptKey, { id, digest: valueDigest, saved }); return saved; }
  async get(context: ExecutionContext, id: string) { const saved = this.drafts.get(id); if (!saved || saved.tenantId !== context.tenantId) fail('DENIED'); return saved!; }
  async list(context: ExecutionContext) { return [...this.drafts.values()].filter((item) => item.tenantId === context.tenantId); }
  async save(context: ExecutionContext, id: string, expectedRevision: number, draft: StudioDraft | GraphDraft, key: string) { const valueDigest = await digest(draft); const receiptKey = `${context.tenantId}:${key}`; const previous = this.commands.get(receiptKey); if (previous) { if (previous.id !== id || previous.digest !== valueDigest) fail('CONFLICT'); return previous.saved; } const current = await this.get(context, id); if (current.revision !== expectedRevision) fail('STALE'); const saved = { ...current, revision: current.revision + 1, digest: valueDigest, draft }; this.drafts.set(id, saved); this.commands.set(receiptKey, { id, digest: valueDigest, saved }); return saved; }
  async appendRun(context: ExecutionContext, id: string, evidence: StudioRunEvidence) { await this.get(context, id); this.checks.set(id, [...this.checks.get(id) ?? [], evidence]); }
  async appendReview() {}
  async rememberCommand(_tenantId: string, _key: string, _requestDigest: string, receipt: StudioReceipt) { return receipt; }
}

class MemoryWorkflow implements WorkflowStore {
  readonly records = new Map<string, WorkflowRecord>(); readonly published = new Map<string, PublishedDefinition>(); readonly receipts = new Map<string, { digest: string; value: Record<string, unknown> }>();
  constructor(private readonly studio: MemoryStudio) {}
  async assertProfile(context: ExecutionContext, profile: 'editor' | 'admin' | 'operator') { if (context.userId !== admin && (context.userId !== editor || profile === 'admin')) fail('DENIED'); }
  private key(tenantId: string, kind: RecordKind, id: string) { return `${tenantId}:${kind}:${id}`; }
  async read<T>(context: ExecutionContext, kind: RecordKind, id: string) { return this.records.get(this.key(String(context.tenantId), kind, id)) as WorkflowRecord<T> | undefined; }
  async list<T>(context: ExecutionContext, kind: RecordKind) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${context.tenantId}:${kind}:`)).map(([, value]) => value as WorkflowRecord<T>); }
  async write(context: ExecutionContext, profile: 'editor' | 'admin' | 'operator', kind: RecordKind, id: string, expectedVersion: number, state: string, data: unknown, key: string, requestDigest: string, receipt: Record<string, unknown>) {
    await this.assertProfile(context, profile); const receiptKey = `${context.tenantId}:${key}`; const existing = this.receipts.get(receiptKey);
    if (existing) { if (existing.digest !== requestDigest) fail('CONFLICT'); return { receipt: existing.value, replayed: true }; }
    await this.workerWrite(String(context.tenantId), kind, id, expectedVersion, state, data);
    this.receipts.set(receiptKey, { digest: requestDigest, value: receipt }); return { receipt, replayed: false };
  }
  async workerRead<T>(tenantId: string, kind: RecordKind, id: string) { return this.records.get(this.key(tenantId, kind, id)) as WorkflowRecord<T> | undefined; }
  async workerList<T>(tenantId: string, kind: RecordKind) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${tenantId}:${kind}:`)).map(([, value]) => value as WorkflowRecord<T>); }
  async workerWrite<T>(tenantId: string, kind: RecordKind, id: string, expectedVersion: number, state: string, data: T) {
    const key = this.key(tenantId, kind, id); const existing = this.records.get(key); if ((existing?.version ?? 0) !== expectedVersion) fail('STALE');
    const value = { id, kind, version: expectedVersion + 1, state, data }; this.records.set(key, value as WorkflowRecord); return value;
  }
  async definitions(context: ExecutionContext, id?: string) { return [...this.published.entries()].filter(([key, value]) => key.startsWith(`${context.tenantId}:`) && (!id || value.id === id)).map(([, value]) => value); }
  async publish(context: ExecutionContext, definition: WorkflowDefinition, id: string, revision: number, draftDigest: string, reviewDigest: string) {
    await this.assertProfile(context, 'admin'); const stored = await this.studio.get(context, id);
    const checks = this.studio.checks.get(id) ?? [];
    if (stored.revision !== revision || stored.digest !== draftDigest || definition.digest !== reviewDigest || !checks.some((item) => item.revision === revision && item.subjectDigest === draftDigest && item.status === 'passed' && item.report['classification'] === 'live' && item.report['candidateDigest'] === definition.digest)) fail('STALE');
    this.published.set(`${context.tenantId}:${definition.id}`, { id: definition.id, draftId: id, draftRevision: revision, digest: definition.digest, definition });
  }
  async workerDefinition(tenantId: string, id: string) { return this.published.get(`${tenantId}:${id}`); }
}

function graph(grantId: string, manifestDigest: string): GraphDraft {
  const node = (id: string, kind: string, config: Record<string, unknown>) => ({ id, kind, title: id, detail: '', x: 1, y: 1, instructions: kind === 'agent' ? 'Classify.' : '', config });
  return { kind: 'graph-v1', nodes: [node('trigger', 'trigger', { mode: 'manual', inputSchema: empty }), node('agent', 'agent', { provider: 'azure-openai', model: 'gpt-4.1', promptVersion: '1', responseSchema: schema, policy, allowedCapabilities: ['write'] }), node('condition', 'condition', { source: 'agent', field: 'result', equals: 'approve' }), node('approval', 'approval', { timeoutMs: 3600000 }), node('mcp', 'mcp', { installationId, capability: 'write', manifestDigest, grantId, target: 'account', arguments: { result: '$node.agent.result' }, policy }), node('done', 'end', {}), node('denied', 'end', {})], edges: [{ id: 'a', from: 'trigger', to: 'agent' }, { id: 'b', from: 'agent', to: 'condition' }, { id: 'c', from: 'condition', to: 'approval', branch: 'true' }, { id: 'd', from: 'condition', to: 'denied', branch: 'false' }, { id: 'e', from: 'approval', to: 'mcp' }, { id: 'f', from: 'mcp', to: 'done' }] };
}

test('authenticated browser journey saves, checks, publishes, waits, approves and records one effect', async () => {
  const identity = new IdentityStore(); for (const id of [tenant, otherTenant]) { identity.provision(id); identity.transition(id, 1, 'activate'); }
  for (const user of [editor, admin]) { identity.mapUser('https://clerk.example', user, user); identity.membership(tenant, user, [user === admin ? 'admin' : 'editor']); identity.setMembership(tenant, user, 1, 'current'); }
  const clerk = new ClerkSessionAdapter({ issuer: 'https://clerk.example', publishableKey: 'pk_test', audience: 'platform-browser-api', authorizedParties: ['https://app.example'] }, {
    verifySessionToken: (token) => ({ issuer: 'https://clerk.example', subject: token, sessionId: token, audience: 'platform-browser-api', expiresAt: '2099-01-01T00:00:00.000Z', tokenUse: 'session', authorizedParty: 'https://app.example' }), getSession: (sessionId) => ({ subject: sessionId, status: 'active' }),
  });
  const studio = new MemoryStudio(); const store = new MemoryWorkflow(studio); const starts: string[] = []; const signals: unknown[] = [];
  const scheduler = { start: async (runId: string) => { if (!starts.includes(runId)) starts.push(runId); }, raise: async (_runId: string, _name: string, value: unknown) => { signals.push(value); } };
  const service = new WorkflowService(studio, store, scheduler, [tenant]);
  let invocations = 0; let outcome: 'succeeded' | 'unknown-outcome' = 'succeeded';
  const memory = new InMemoryHostedMemoryPort([tenant]);
  const worker = new WorkflowWorker(store, { complete: async (request) => ({ output: { result: 'approve' }, model: request.model, tokens: 20, cost: 0.01 }) }, { invoke: async () => { invocations += 1; return outcome === 'succeeded' ? { outcome, output: { result: 'written' } } : { outcome }; } }, memory);
  const browser = new BrowserV1Transport({ allowedOrigins: ['https://app.example'], clerk, identity, commands: workflowCommandHandlers(studio, store, service), projections: (input) => service.projection(input.context, input.collection, input.id) });
  const command = async (user: string, name: string, version: number, values: Record<string, unknown>, key = randomUUID()) => {
    const [owner, action] = name.split('.'); const envelope: ContractEnvelope = { messageId: randomUUID() as ContractEnvelope['messageId'], contract: 'browser.v1', contractVersion: '1.0.0', occurredAt: new Date().toISOString(), sender: 'test', tenantId: tenantId(tenant), classification: 'restricted-operational', payload: { expectedVersion: version, arguments: values } };
    const response = await browser.handle({ method: 'POST', path: `/api/v1/tenants/${tenant}/commands/${owner}/${action}`, headers: { authorization: `Bearer ${user}`, origin: 'https://app.example', 'content-type': 'application/vnd.platform.browser.v1+json', 'idempotency-key': key, 'x-correlation-id': randomUUID(), 'if-match': String(version) }, body: new TextEncoder().encode(JSON.stringify(envelope)) });
    return { status: response.status, payload: decodeContract(descriptorFor('browser.v1'), response.body).payload };
  };
  const projection = async (user: string, collection: string, targetTenant = tenant) => {
    const response = await browser.handle({ method: 'GET', path: `/api/v1/tenants/${targetTenant}/${collection}`, headers: { authorization: `Bearer ${user}`, origin: 'https://app.example' } });
    return { status: response.status, payload: decodeContract(descriptorFor('browser.v1'), response.body).payload };
  };
  const manifest = { version: '1', certified: true, capabilities: [{ name: 'write', risk: 'R2', inputSchema: schema, outputSchema: schema }] };
  const manifestDigest = await digest({ version: manifest.version, capabilities: manifest.capabilities });
  expect((await command(admin, 'workflow.certify', 0, { id: installationId, installation: { route: 'public', endpoint: 'https://example.com/mcp', health: 'healthy', manifest: { ...manifest, digest: manifestDigest } } })).status).toBe(200);
  const first = graph(randomUUID(), manifestDigest);
  const createKey = randomUUID();
  expect((await command(editor, 'studio.create-draft', 0, { id: draftId, draft: first }, createKey)).status).toBe(200);
  expect((await command(editor, 'studio.create-draft', 0, { id: draftId, draft: first }, createKey)).payload).toMatchObject({ revision: 1, state: 'draft' });
  expect((await projection(editor, 'workflow-drafts')).payload['records']).toMatchObject([{ id: draftId, revision: 1 }]);
  expect((await command(editor, 'studio.save-draft', 0, { id: draftId, draft: first })).payload['error']).toMatchObject({ category: 'conflict' });
  const grantKey = randomUUID();
  expect((await command(admin, 'workflow.grant', 0, { id: draftId, nodeId: 'mcp', installationId, capability: 'write' }, grantKey)).status).toBe(200);
  const valid = graph(grantKey, manifestDigest);
  const saveKey = randomUUID();
  expect((await command(editor, 'studio.save-draft', 1, { id: draftId, draft: valid }, saveKey)).status).toBe(200);
  expect((await command(editor, 'studio.save-draft', 1, { id: draftId, draft: valid }, saveKey)).payload).toMatchObject({ revision: 2, state: 'draft' });
  const checked = await command(editor, 'workflow.check', 2, { id: draftId });
  expect(checked.payload).toMatchObject({ state: 'passed', issues: [] });
  expect((await command(editor, 'workflow.publish', 2, { id: draftId, reviewDigest: checked.payload['digest'] })).payload['error']).toMatchObject({ category: 'denied' });
  const published = await command(admin, 'workflow.publish', 2, { id: draftId, reviewDigest: checked.payload['digest'] });
  expect(published.status).toBe(200); const definitionId = String(published.payload['objectId']);
  const startKey = randomUUID(); const started = await command(editor, 'workflow.start', 0, { id: definitionId, input: {} }, startKey);
  expect(started.status).toBe(200); expect(starts).toEqual([startKey]);
  const replay = await command(editor, 'workflow.start', 0, { id: definitionId, input: {} }, startKey);
  expect(replay.status).toBe(200); expect(starts).toEqual([startKey]);
  for (const nodeId of ['trigger', 'agent', 'condition']) await worker.step(tenant, startKey, definitionId, nodeId);
  expect(await worker.step(tenant, startKey, definitionId, 'approval')).toMatchObject({ waiting: 'approval' });
  const waiting = (await store.workerRead<WorkflowRun>(tenant, 'run', startKey))!;
  expect(waiting.data.waiting?.review).toMatchObject({ revision: 2, installationId, capability: 'write', target: 'account', arguments: [{ name: 'result', type: 'string' }] });
  expect(JSON.stringify(waiting.data.waiting?.review)).not.toContain('approve');
  expect((await command(admin, 'workflow.approve', waiting.version, { id: startKey, bindingDigest: waiting.data.waiting!.bindingDigest, decision: 'approve' })).status).toBe(200);
  expect(signals).toHaveLength(1);
  await worker.step(tenant, startKey, definitionId, 'approval'); await worker.step(tenant, startKey, definitionId, 'mcp'); await worker.step(tenant, startKey, definitionId, 'done');
  expect(invocations).toBe(1);
  expect((await projection(editor, 'workflow-runs')).payload['records']).toMatchObject([{ id: startKey, status: 'completed', definitionRevision: 2, history: expect.arrayContaining([expect.objectContaining({ nodeId: 'mcp', receiptId: expect.any(String) })]), effects: [expect.objectContaining({ nodeId: 'mcp', state: 'succeeded', argumentsDigest: expect.any(String) })] }]);
  expect((await projection(editor, 'workflow-runs', otherTenant)).payload['error']).toMatchObject({ category: 'denied' });
  const completed = await store.workerRead<WorkflowRun>(tenant, 'run', startKey);
  expect(completed?.data.history.map((event) => event.nodeId)).toEqual(['trigger', 'agent', 'agent', 'condition', 'approval', 'approval', 'mcp', 'done']);
  expect(completed?.data.history[1]).toMatchObject({ kind: 'agent', state: 'attempted', detail: 'azure-openai:gpt-4.1:1:succeeded' });
  await expect(worker.summarize(tenant, startKey)).rejects.toMatchObject({ code: 'SUMMARY_NOT_READY' });
  await worker.summaryFailed(tenant, startKey);
  expect((await store.workerRead<WorkflowRun>(tenant, 'run', startKey))?.data).toMatchObject({ status: 'completed', summaryStatus: 'failed' });
  expect(await worker.step(tenant, startKey, definitionId, 'mcp')).toMatchObject({ next: 'done' });
  expect(invocations).toBe(1);
  outcome = 'unknown-outcome';
  const uncertainId = randomUUID();
  expect((await command(editor, 'workflow.start', 0, { id: definitionId, input: {} }, uncertainId)).status).toBe(200);
  for (const nodeId of ['trigger', 'agent', 'condition', 'approval']) await worker.step(tenant, uncertainId, definitionId, nodeId);
  const uncertainApproval = (await store.workerRead<WorkflowRun>(tenant, 'run', uncertainId))!;
  expect((await command(admin, 'workflow.approve', uncertainApproval.version, { id: uncertainId, bindingDigest: uncertainApproval.data.waiting!.bindingDigest, decision: 'approve' })).status).toBe(200);
  await worker.step(tenant, uncertainId, definitionId, 'mcp');
  expect((await store.workerRead<WorkflowRun>(tenant, 'run', uncertainId))?.state).toBe('unknown-outcome');
  expect(await worker.step(tenant, uncertainId, definitionId, 'mcp')).toMatchObject({ failed: true });
  expect(invocations).toBe(2);
  const unknown = (await store.workerRead<WorkflowRun>(tenant, 'run', uncertainId))!;
  expect((await command(editor, 'workflow.reconcile', unknown.version, { id: uncertainId, disposition: 'no-effect' })).payload['error']).toMatchObject({ category: 'denied' });
  expect((await command(admin, 'workflow.reconcile', unknown.version, { id: uncertainId, disposition: 'no-effect' })).status).toBe(200);
  expect((await store.workerRead<WorkflowRun>(tenant, 'run', uncertainId))?.state).toBe('failed');
  let modelCalls = 0;
  const unavailable = new WorkflowWorker(store, { complete: async () => { modelCalls += 1; throw new Error('unavailable'); } }, { invoke: async () => ({ outcome: 'not-dispatched' }) }, memory);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const runId = randomUUID();
    expect((await command(editor, 'workflow.start', 0, { id: definitionId, input: {} }, runId)).status).toBe(200);
    await unavailable.step(tenant, runId, definitionId, 'trigger');
    expect(await unavailable.step(tenant, runId, definitionId, 'agent')).toMatchObject({ failed: true });
  }
  const blockedId = randomUUID();
  expect((await command(editor, 'workflow.start', 0, { id: definitionId, input: {} }, blockedId)).status).toBe(200);
  await unavailable.step(tenant, blockedId, definitionId, 'trigger');
  expect(await unavailable.step(tenant, blockedId, definitionId, 'agent')).toMatchObject({ waiting: 'circuit' });
  expect(modelCalls).toBe(3);
  const summaryWorker = new WorkflowWorker(store, { complete: async () => ({ output: {}, model: 'unused', tokens: 0, cost: 0 }), summarize: async () => ({ text: 'Source-linked summary.', sources: ['agent'] }) }, { invoke: async () => ({ outcome: 'not-dispatched' }) }, memory);
  await summaryWorker.summarize(tenant, startKey);
  const memoryDraftId = randomUUID();
  const memoryGraph: GraphDraft = { kind: 'graph-v1', nodes: [
    { id: 'start', kind: 'trigger', title: 'Start', detail: '', x: 1, y: 1, instructions: '', config: { mode: 'manual', inputSchema: empty } },
    { id: 'memory', kind: 'memory', title: 'Memory', detail: '', x: 2, y: 2, instructions: '', config: { limit: 1, maxChars: 1000, policy } },
    { id: 'end', kind: 'end', title: 'End', detail: '', x: 3, y: 3, instructions: '', config: {} },
  ], edges: [{ id: 'one', from: 'start', to: 'memory' }, { id: 'two', from: 'memory', to: 'end' }] };
  expect((await command(editor, 'studio.create-draft', 0, { id: memoryDraftId, draft: memoryGraph })).status).toBe(200);
  const memoryCheck = await command(editor, 'workflow.check', 1, { id: memoryDraftId });
  expect(memoryCheck.payload['state']).toBe('passed');
  const memoryDefinition = await command(admin, 'workflow.publish', 1, { id: memoryDraftId, reviewDigest: memoryCheck.payload['digest'] });
  const targetDefinitionId = String(memoryDefinition.payload['objectId']);
  const memoryWorker = new WorkflowWorker(store, { complete: async () => ({ output: {}, model: 'unused', tokens: 0, cost: 0 }) }, { invoke: async () => ({ outcome: 'not-dispatched' }) }, memory);
  const unimportedId = randomUUID();
  expect((await command(editor, 'workflow.start', 0, { id: targetDefinitionId, input: {} }, unimportedId)).status).toBe(200);
  await memoryWorker.step(tenant, unimportedId, targetDefinitionId, 'start'); await memoryWorker.step(tenant, unimportedId, targetDefinitionId, 'memory');
  expect((await store.workerRead<WorkflowRun>(tenant, 'run', unimportedId))?.data.outputs['memory']).toEqual({ memory: { status: 'empty', items: [] } });
  expect((await command(editor, 'workflow.import-memory', 0, { id: targetDefinitionId, sourceDefinitionId: draftId })).payload['error']).toMatchObject({ category: 'denied' });
  expect((await command(admin, 'workflow.import-memory', 0, { id: targetDefinitionId, sourceDefinitionId: draftId })).status).toBe(200);
  expect((await projection(editor, 'workflow-memory-imports')).payload['records']).toMatchObject([expect.objectContaining({ targetDefinitionId, sourceDefinitionId: draftId, state: 'active' })]);
  const importedId = randomUUID();
  expect((await command(editor, 'workflow.start', 0, { id: targetDefinitionId, input: {} }, importedId)).status).toBe(200);
  await memoryWorker.step(tenant, importedId, targetDefinitionId, 'start'); await memoryWorker.step(tenant, importedId, targetDefinitionId, 'memory');
  expect((await store.workerRead<WorkflowRun>(tenant, 'run', importedId))?.data.outputs['memory']).toMatchObject({ memory: { status: 'success', items: [expect.objectContaining({ text: 'Source-linked summary.' })] } });
  const imported = (await projection(editor, 'workflow-memory-imports')).payload['records'] as Record<string, unknown>[];
  const attachment = imported.find((item) => item['targetDefinitionId'] === targetDefinitionId)!;
  expect((await command(editor, 'workflow.revoke-memory-import', Number(attachment['version']), { id: String(attachment['id']), reason: 'no longer needed' })).payload['error']).toMatchObject({ category: 'denied' });
  expect((await command(admin, 'workflow.revoke-memory-import', Number(attachment['version']), { id: String(attachment['id']), reason: 'no longer needed' })).status).toBe(200);
  const revokedId = randomUUID();
  expect((await command(editor, 'workflow.start', 0, { id: targetDefinitionId, input: {} }, revokedId)).status).toBe(200);
  await memoryWorker.step(tenant, revokedId, targetDefinitionId, 'start'); await memoryWorker.step(tenant, revokedId, targetDefinitionId, 'memory');
  expect((await store.workerRead<WorkflowRun>(tenant, 'run', revokedId))?.data.outputs['memory']).toEqual({ memory: { status: 'empty', items: [] } });
  const item = (await store.workerList<MemoryItem>(tenant, 'memory-item')).find((candidate) => candidate.state === 'promoted')!;
  expect((await command(admin, 'workflow.withdraw-memory', item.version, { id: item.id, reason: 'source no longer valid' })).status).toBe(200);
  expect((await store.workerRead<MemoryItem>(tenant, 'memory-item', item.id))?.state).toBe('withdrawn');
  const failedItemId = randomUUID();
  await store.workerWrite<MemoryItem>(tenant, 'memory-item', failedItemId, 0, 'failed', { stableDefinitionId: memoryDraftId, definitionId: targetDefinitionId, producingRevision: 1, type: 'task-fact', sourceId: `event:${importedId}:memory`, sourceDigest: 'a'.repeat(64), sourceKind: 'event', fingerprint: 'b'.repeat(64), failure: 'Bearer provider-secret', vectorState: 'pending' });
  const failedRunId = randomUUID(); const failedRun = (await store.workerRead<WorkflowRun>(tenant, 'run', importedId))!;
  await store.workerWrite(tenant, 'run', failedRunId, 0, 'completed', { ...failedRun.data, id: failedRunId });
  await store.workerWrite(tenant, 'memory-retrieval', randomUUID(), 0, 'unavailable', { runId: failedRunId, nodeId: 'memory', status: 'unavailable', itemIds: [], importIds: [], failure: 'Bearer provider-secret' });
  const memoryItems = (await projection(editor, 'workflow-memory-items')).payload['records'] as Record<string, unknown>[];
  expect(memoryItems.find((candidate) => candidate['id'] === failedItemId)).toMatchObject({ type: 'task-fact', state: 'failed', sourceDigest: 'a'.repeat(64), ownerScoped: false, hold: false, failure: 'provider-failed', vectorState: 'pending' });
  expect(JSON.stringify(memoryItems)).not.toContain('provider-secret');
  const memoryRuns = (await projection(editor, 'workflow-runs')).payload['records'] as Record<string, unknown>[];
  expect(memoryRuns.find((candidate) => candidate['id'] === failedRunId)).toMatchObject({ definitionId: targetDefinitionId, retrievals: [expect.objectContaining({ nodeId: 'memory', status: 'unavailable', itemIds: [], importIds: [], failure: 'provider-failed' })] });
  expect(JSON.stringify(memoryRuns)).not.toContain('provider-secret');
  const proposalInput = { statement: 'Use email only.' };
  const proposalInputSchema = { type: 'object' as const, properties: { statement: { type: 'string' as const } }, required: ['statement'], additionalProperties: false as const };
  const proposalResponseSchema = { type: 'object' as const, properties: { result: { type: 'string' as const }, memoryProposals: { type: 'array' as const } }, required: ['result'], additionalProperties: false as const };
  const proposalRunId = randomUUID(); const proposalDigest = await digest(proposalInput); const proposalDraftId = randomUUID();
  const proposalGraph: GraphDraft = { kind: 'graph-v1', nodes: [
    { id: 'start', kind: 'trigger', title: 'Start', detail: '', x: 1, y: 1, instructions: '', config: { mode: 'manual', inputSchema: proposalInputSchema } },
    { id: 'agent', kind: 'agent', title: 'Agent', detail: '', x: 2, y: 2, instructions: 'Record supported preferences.', config: { provider: 'openrouter', openRouterOptIn: true, model: 'gpt-4.1', promptVersion: '1', responseSchema: proposalResponseSchema, policy, allowedCapabilities: [] } },
    { id: 'end', kind: 'end', title: 'End', detail: '', x: 3, y: 3, instructions: '', config: {} },
  ], edges: [{ id: 'one', from: 'start', to: 'agent' }, { id: 'two', from: 'agent', to: 'end' }] };
  expect((await command(editor, 'studio.create-draft', 0, { id: proposalDraftId, draft: proposalGraph })).status).toBe(200);
  const proposalCheck = await command(editor, 'workflow.check', 1, { id: proposalDraftId });
  const proposalDefinition = await command(admin, 'workflow.publish', 1, { id: proposalDraftId, reviewDigest: proposalCheck.payload['digest'] });
  const proposalDefinitionId = String(proposalDefinition.payload['objectId']);
  const proposalWorker = new WorkflowWorker(store, { complete: async (request) => ({ output: { result: 'recorded', memoryProposals: [{ type: 'stated-preference', text: 'Use email only.', sourceId: `input:${proposalRunId}`, sourceDigest: proposalDigest, excerpt: 'Use email only.', subject: editor }, { type: 'task-fact' }] }, model: request.model, tokens: 20, cost: 0.01 }) }, { invoke: async () => ({ outcome: 'not-dispatched' }) }, memory);
  expect((await command(editor, 'workflow.start', 0, { id: proposalDefinitionId, input: proposalInput }, proposalRunId)).status).toBe(200);
  await proposalWorker.step(tenant, proposalRunId, proposalDefinitionId, 'start'); await proposalWorker.step(tenant, proposalRunId, proposalDefinitionId, 'agent'); await proposalWorker.step(tenant, proposalRunId, proposalDefinitionId, 'end'); await proposalWorker.promote(tenant, proposalRunId);
  const proposalStates = (await store.workerList<MemoryItem>(tenant, 'memory-item')).filter((candidate) => candidate.data.sourceId.includes(proposalRunId)).map((candidate) => candidate.state);
  expect(proposalStates).toEqual(expect.arrayContaining(['promoted', 'rejected']));

  const expiryItemId = randomUUID(); const currentExpiry = new Date(Date.now() + 86400000).toISOString(); const shorterExpiry = new Date(Date.now() + 3600000).toISOString();
  await store.workerWrite<MemoryItem>(tenant, 'memory-item', expiryItemId, 0, 'promoted', { stableDefinitionId: memoryDraftId, definitionId: targetDefinitionId, producingRevision: 1, type: 'task-fact', sourceId: `event:${importedId}:expiry`, sourceDigest: 'a'.repeat(64), sourceKind: 'event', fingerprint: 'c'.repeat(64), expiresAt: currentExpiry, vectorState: 'ready' });
  expect((await command(admin, 'workflow.set-memory-expiry', 1, { id: expiryItemId, expiresAt: shorterExpiry })).status).toBe(200);
  expect((await store.workerRead<MemoryItem>(tenant, 'memory-item', expiryItemId))?.data.expiresAt).toBe(shorterExpiry);
  expect((await command(admin, 'workflow.set-memory-expiry', 1, { id: expiryItemId, expiresAt: shorterExpiry })).payload['error']).toMatchObject({ category: 'conflict', code: 'STALE' });
  expect((await command(editor, 'workflow.set-memory-expiry', 2, { id: expiryItemId, expiresAt: shorterExpiry })).payload['error']).toMatchObject({ category: 'denied' });
  expect((await command(admin, 'workflow.set-memory-expiry', 2, { id: expiryItemId, expiresAt: currentExpiry })).payload['error']).toMatchObject({ category: 'invalid' });
  expect((await command(admin, 'workflow.hold-memory', 2, { id: expiryItemId, reason: 'retention review' })).status).toBe(200);
  expect((await command(admin, 'workflow.delete-memory', 3, { id: expiryItemId, reason: 'retention review' })).payload['error']).toMatchObject({ category: 'denied' });
});
