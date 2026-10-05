import { describe, expect, test } from 'vitest';
import { digest } from '../../contracts/src/index.js';
import { InMemoryHostedMemoryPort, type HostedMemoryItem, type MemoryItem, type MemoryItemType } from './memory.js';
import type { ConsolidationAnswer, ConsolidationRecord, ConsolidationRequest } from './memory-consolidation.js';
import type { OutcomeDraft } from './memory-outcome.js';
import { WorkflowWorker, type ModelPort } from './runtime.js';
import { WorkflowService, type WorkflowRun } from './service.js';
import { MemoryRecords, TENANT, DEFINITION, POLICY, asStore, contextFor, idle, publish, seedRun, readRun } from './worker-harness.test-support.js';

const NS = `tenant-${TENANT}`;
const RUN = '99999999-9999-4999-8999-999999999999';
const first = <T>(list: readonly T[]): T => { const [head] = list; if (head === undefined) throw new Error('EMPTY'); return head; };
const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const day = 86400000;
const iso = (offsetDays: number): string => new Date(Date.now() + offsetDays * day).toISOString();

interface Seed { text: string; type?: MemoryItemType; subjects?: string[]; state?: 'pending' | 'promoted'; observedAt?: string; ownerId?: string; hold?: boolean; sourceId?: string; legacy?: boolean; expiresAt?: string; skipSql?: boolean; }
const trigger = { id: 'trigger', kind: 'trigger', config: {}, next: 'agent' } as const;
const agentNode = { id: 'agent', kind: 'agent', config: {}, next: 'recall' } as const;
const recallNode = (limit: number, maxChars: number) => ({ id: 'recall', kind: 'memory', config: { limit, maxChars, policy: POLICY }, next: 'end' }) as const;
const endNode = { id: 'end', kind: 'end', config: {}, next: null } as const;

interface Env { records: MemoryRecords; memory: InMemoryHostedMemoryPort; worker: WorkflowWorker; scores: Map<string, number>; queries: { text: string; topK: number; filter: unknown }[]; consolidations: ConsolidationRequest[]; listed: string[]; seed(id: string, seed: Seed): Promise<void>; run(patch?: Partial<WorkflowRun>): Promise<void>; consolidation(id: string): Promise<ConsolidationRecord | undefined>; }
interface Options { draft?: OutcomeDraft; answer?: (request: ConsolidationRequest) => ConsolidationAnswer; withConsolidate?: boolean; limit?: number; maxChars?: number; input?: Record<string, unknown>; }

const salientDraft: OutcomeDraft = { salient: true, subjects: ['NPM:zod'], outcome: 'zod judged low risk for request validation', findings: [{ text: 'zod had 1 open advisory', sourceNodeId: 'agent', excerpt: 'GHSA-m95q-7qp3-xv42' }], status: 'completed' };
const completedHistory = [{ nodeId: 'trigger', kind: 'trigger', state: 'completed' as const, at: '2026-10-04T10:00:00.000Z' }, { nodeId: 'agent', kind: 'agent', state: 'completed' as const, at: '2026-10-04T10:00:05.000Z' }, { nodeId: 'end', kind: 'end', state: 'completed' as const, at: '2026-10-04T10:00:09.000Z' }];

function setup(options: Options = {}): Env {
  const records = new MemoryRecords(); const scores = new Map<string, number>(); const queries: Env['queries'] = []; const consolidations: ConsolidationRequest[] = []; const listed: string[] = [];
  const memory = new InMemoryHostedMemoryPort([TENANT], (_query, text) => scores.get(text) ?? 0.5);
  const base = memory.query.bind(memory);
  memory.query = async (space, text, topK, filter) => { queries.push({ text, topK, filter }); return base(space, text, topK, filter); };
  const store = asStore(records); const list = store.workerList.bind(store);
  store.workerList = async (tenant, kind) => { listed.push(kind); return list(tenant, kind); };
  const model: ModelPort = { complete: () => Promise.reject(new Error('unused')), summarize: () => Promise.resolve(options.draft ?? salientDraft), ...(options.withConsolidate === false ? {} : { consolidate: (request: ConsolidationRequest) => { consolidations.push(request); return Promise.resolve(options.answer ? options.answer(request) : { decision: 'add', model: 'm', promptVersion: 'memory-consolidate-v1' }); } }) };
  const worker = new WorkflowWorker(store, model, idle, memory);
  const definition = publish(records, [trigger, agentNode, recallNode(options.limit ?? 5, options.maxChars ?? 2000), endNode], []);
  return {
    records, memory, worker, scores, queries, consolidations, listed,
    async seed(id, seed) {
      const type = seed.type ?? 'task-fact'; const state = seed.state ?? 'promoted'; const sourceId = seed.sourceId ?? `input:earlier-${id}`; const sourceDigest = 'a'.repeat(64);
      const metadata: HostedMemoryItem['metadata'] = { stableDefinitionId: DEFINITION, definitionId: DEFINITION, producingRevision: 1, type, sourceId, sourceDigest, state, expiresAt: seed.expiresAt ?? iso(30), ...(seed.ownerId ? { ownerId: seed.ownerId } : {}), ...(seed.legacy ? {} : { subjects: seed.subjects ?? [], schemaVersion: 2 as const }), ...(seed.observedAt ? { observedAt: seed.observedAt } : {}) };
      await memory.upsert(NS, { id, text: seed.text, metadata });
      if (seed.skipSql) return;
      const item: MemoryItem = { stableDefinitionId: DEFINITION, definitionId: DEFINITION, producingRevision: 1, type, sourceId, sourceDigest, sourceKind: 'input', fingerprint: await digest({ id }), ...(seed.ownerId ? { ownerId: seed.ownerId } : {}), ...(seed.hold ? { hold: true } : {}), expiresAt: seed.expiresAt ?? iso(30), vectorState: state === 'promoted' ? 'ready' : 'pending', ...(seed.legacy ? {} : { subjects: seed.subjects ?? [], schemaVersion: 2 as const }), ...(seed.observedAt ? { observedAt: seed.observedAt } : {}), ...(state === 'promoted' ? { promotedAt: seed.observedAt ?? iso(-1) } : {}) };
      await records.workerWrite(TENANT, 'memory-item', id, 0, state, item);
    },
    async run(patch = {}) { await seedRun(records, definition, RUN, options.input ?? { package: 'zod' }, { status: 'completed', history: completedHistory, outputs: { agent: { verdict: 'low risk', advisories: 1, id: 'GHSA-m95q-7qp3-xv42' }, end: {} }, ...patch }); },
    async consolidation(id) { return (await records.workerRead<ConsolidationRecord>(TENANT, 'memory-consolidation', id))?.data; },
  };
}

const items = async (env: Env) => env.records.workerList<MemoryItem>(TENANT, 'memory-item');
const byId = async (env: Env, id: string): Promise<{ state: string; version: number; data: MemoryItem }> => {
  const record = await env.records.workerRead<MemoryItem>(TENANT, 'memory-item', id);
  if (!record) throw new Error('MISSING');
  return record;
};
const supersedeFirst = (request: ConsolidationRequest): ConsolidationAnswer => ({ decision: 'supersede', targetId: first(request.candidates).id, model: 'm', promptVersion: 'p' });
const noopFirst = (request: ConsolidationRequest): ConsolidationAnswer => ({ decision: 'noop', targetId: first(request.candidates).id, model: 'm', promptVersion: 'p' });
const states = async (env: Env) => Object.fromEntries((await items(env)).map((item) => [item.id, item.state]));

describe('Phase 1: Run Outcome Record', () => {
  test('a salient run stages one record that leads with its subject keys and names its conclusion', async () => {
    const env = setup(); await env.run();
    await env.worker.summarize(TENANT, RUN);
    const all = await items(env);
    expect(all).toHaveLength(1);
    const record = first(all);
    const hosted = await env.memory.read(NS, record.id);
    expect(hosted?.text).toBe('npm:zod: zod judged low risk for request validation. zod had 1 open advisory.');
    expect(record).toMatchObject({ state: 'promoted', data: { type: 'run-summary', sourceKind: 'summary', subjects: ['npm:zod'], schemaVersion: 2, observedAt: '2026-10-04T10:00:09.000Z', sourceId: `summary:${RUN}` } });
    expect(hosted?.metadata).toMatchObject({ subjects: ['npm:zod'], schemaVersion: 2, state: 'promoted' });
    expect(Date.parse(record.data.expiresAt ?? '') - Date.now()).toBeLessThanOrEqual(30 * day);
    expect((await readRun(env.records, RUN)).data.summaryStatus).toBe('ready');
    expect((await env.records.workerRead(TENANT, 'summary', RUN))?.state).toBe('ready');
  });

  test('a run with no reusable conclusion stages nothing and still settles the summary status', async () => {
    const env = setup({ draft: { salient: false, subjects: [], outcome: '', findings: [], status: 'completed' } }); await env.run();
    await env.worker.summarize(TENANT, RUN);
    expect(await items(env)).toHaveLength(0);
    expect((await env.records.workerRead(TENANT, 'summary', RUN))?.state).toBe('skipped');
    expect((await readRun(env.records, RUN)).data.summaryStatus).toBe('ready');
  });

  test('a finding with a fabricated excerpt is dropped while grounded findings survive', async () => {
    const env = setup({ draft: { ...salientDraft, findings: [...salientDraft.findings, { text: 'zod had 99 stars', sourceNodeId: 'agent', excerpt: 'stars: 99' }, { text: 'wrong node', sourceNodeId: 'ghost', excerpt: 'GHSA-m95q-7qp3-xv42' }] } }); await env.run();
    await env.worker.summarize(TENANT, RUN);
    const record = first(await items(env));
    expect((await env.memory.read(NS, record.id))?.text).toBe('npm:zod: zod judged low risk for request validation. zod had 1 open advisory.');
  });

  test('an excerpt is checked against the run input when its node has no output', async () => {
    const env = setup({ draft: { ...salientDraft, findings: [{ text: 'package was zod', sourceNodeId: 'trigger', excerpt: '"package":"zod"' }] } }); await env.run();
    await env.worker.summarize(TENANT, RUN);
    expect((await env.memory.read(NS, first(await items(env)).id))?.text).toContain('package was zod');
  });

  test('a record whose findings are all ungrounded stages nothing unless the outcome itself is quoted from the evidence', async () => {
    const ungrounded: OutcomeDraft = { ...salientDraft, findings: [{ text: 'invented', sourceNodeId: 'agent', excerpt: 'never said' }] };
    const env = setup({ draft: ungrounded }); await env.run();
    await env.worker.summarize(TENANT, RUN);
    expect(await items(env)).toHaveLength(0);
    expect((await env.records.workerRead(TENANT, 'summary', RUN))?.state).toBe('ungrounded');
    expect((await readRun(env.records, RUN)).data.summaryStatus).toBe('ready');
    const quoted = setup({ draft: { ...ungrounded, outcome: 'low risk' } }); await quoted.run();
    await quoted.worker.summarize(TENANT, RUN);
    expect(await items(quoted)).toHaveLength(1);
  });

  test('text changed by redaction rejects the whole record', async () => {
    const env = setup({ draft: { ...salientDraft, outcome: 'login works with password: hunter2' } }); await env.run();
    await env.worker.summarize(TENANT, RUN);
    expect(await items(env)).toHaveLength(0);
    expect((await env.records.workerRead(TENANT, 'summary', RUN))?.state).toBe('rejected');
  });

  test('replaying the summary produces one item and calls the model once', async () => {
    const env = setup(); await env.run(); let calls = 0;
    const worker = new WorkflowWorker(asStore(env.records), { complete: () => Promise.reject(new Error('unused')), summarize: () => { calls += 1; return Promise.resolve(salientDraft); } }, idle, env.memory);
    await worker.summarize(TENANT, RUN); await worker.summarize(TENANT, RUN);
    expect(await items(env)).toHaveLength(1); expect(calls).toBe(1);
  });

  test('malformed model output fails the summary so the durable activity can retry', async () => {
    const env = setup({ draft: { ...salientDraft, outcome: 'x'.repeat(301) } }); await env.run();
    await expect(env.worker.summarize(TENANT, RUN)).rejects.toThrow('INVALID_SUMMARY');
    expect(await env.records.workerRead(TENANT, 'summary', RUN)).toBeUndefined();
  });

  test('failed and non-completed runs are still not summarized', async () => {
    const env = setup(); await env.run({ status: 'failed' });
    await env.worker.summarize(TENANT, RUN);
    expect(await items(env)).toHaveLength(0);
  });
});

describe('Phase 3: consolidation at promotion', () => {
  const pendingFor = (n: number, text: string, extra: Partial<Seed> = {}): [string, Seed] => [uid(n), { text, state: 'pending', sourceId: `input:${RUN}`, observedAt: iso(0), ...extra }];

  test('a near-identical item with the same subjects and type is a NOOP: rejected, its vector removed, the kept item recorded', async () => {
    const env = setup(); await env.run();
    await env.seed(uid(1), { text: 'zod is safe', subjects: ['npm:zod'] });
    await env.seed(...pendingFor(2, 'zod is safe too', { subjects: ['npm:zod'] }));
    env.scores.set('zod is safe', 0.98);
    await env.worker.promote(TENANT, RUN);
    expect(await states(env)).toEqual({ [uid(1)]: 'promoted', [uid(2)]: 'rejected' });
    expect(await byId(env, uid(2))).toMatchObject({ data: { failure: 'DUPLICATE', vectorState: 'removed' } });
    expect(await env.memory.read(NS, uid(2))).toBeUndefined();
    expect(await env.consolidation(uid(2))).toMatchObject({ decision: 'noop', targetId: uid(1), path: 'deterministic' });
    expect(env.consolidations).toHaveLength(0);
  });

  test('no candidate above the consolidation threshold means ADD without a model call', async () => {
    const env = setup(); await env.run();
    await env.seed(uid(1), { text: 'lodash notes', subjects: ['npm:lodash'] });
    await env.seed(...pendingFor(2, 'zod notes', { subjects: ['npm:zod'] }));
    env.scores.set('lodash notes', 0.5);
    await env.worker.promote(TENANT, RUN);
    expect(await states(env)).toEqual({ [uid(1)]: 'promoted', [uid(2)]: 'promoted' });
    expect(await env.consolidation(uid(2))).toMatchObject({ decision: 'add', path: 'deterministic' });
    expect(env.consolidations).toHaveLength(0);
  });

  test('candidates are restricted to the same definition and the leading subject', async () => {
    const env = setup(); await env.run();
    await env.seed(...pendingFor(2, 'zod notes', { subjects: ['npm:zod', 'repo:acme/api'] }));
    await env.worker.promote(TENANT, RUN);
    expect(env.queries.at(-1)).toMatchObject({ topK: 8, filter: { state: 'promoted', stableDefinitionId: DEFINITION, subjects: { contains: 'npm:zod' } } });
  });

  test('a newer contradicting fact supersedes: predecessor withdrawn with its vector removed, successor linked', async () => {
    const env = setup({ answer: supersedeFirst }); await env.run();
    await env.seed(uid(1), { text: 'zod has 1 open advisory', subjects: ['npm:zod'], observedAt: iso(-5) });
    await env.seed(...pendingFor(2, 'zod has 0 open advisories', { subjects: ['npm:zod'] }));
    env.scores.set('zod has 1 open advisory', 0.92);
    await env.worker.promote(TENANT, RUN);
    expect(await states(env)).toEqual({ [uid(1)]: 'withdrawn', [uid(2)]: 'promoted' });
    expect((await byId(env, uid(1))).data).toMatchObject({ supersededBy: uid(2), vectorState: 'removed' });
    expect((await byId(env, uid(2))).data).toMatchObject({ predecessorId: uid(1), vectorState: 'ready' });
    expect(await env.memory.read(NS, uid(1))).toBeUndefined();
    expect(env.consolidations).toHaveLength(1);
    expect(env.consolidations[0]).toMatchObject({ runId: RUN, item: { text: 'zod has 0 open advisories' }, candidates: [{ id: uid(1), text: 'zod has 1 open advisory' }] });
    expect(await env.consolidation(uid(2))).toMatchObject({ decision: 'supersede', targetId: uid(1), path: 'model', model: 'm', promptVersion: 'p' });
  });

  test('a legal hold on the target blocks supersession and the decision falls back to ADD', async () => {
    const env = setup({ answer: supersedeFirst }); await env.run();
    await env.seed(uid(1), { text: 'held fact', subjects: ['npm:zod'], hold: true });
    await env.seed(...pendingFor(2, 'newer fact', { subjects: ['npm:zod'] }));
    env.scores.set('held fact', 0.92);
    await env.worker.promote(TENANT, RUN);
    expect(await states(env)).toEqual({ [uid(1)]: 'promoted', [uid(2)]: 'promoted' });
    expect(await env.consolidation(uid(2))).toMatchObject({ decision: 'add' });
    expect((await byId(env, uid(2))).data.predecessorId).toBeUndefined();
  });

  test('a hold placed after the decision is honoured when the supersession is applied', async () => {
    const env = setup({ answer: supersedeFirst }); await env.run();
    await env.seed(uid(1), { text: 'fact', subjects: ['npm:zod'] });
    await env.seed(...pendingFor(2, 'newer fact', { subjects: ['npm:zod'] }));
    env.scores.set('fact', 0.92);
    const first = await byId(env, uid(1));
    await env.records.workerWrite(TENANT, 'memory-consolidation', uid(2), 0, 'supersede', { decision: 'supersede', targetId: uid(1), path: 'model', scores: [] } satisfies ConsolidationRecord);
    await env.records.workerWrite(TENANT, 'memory-item', uid(1), first.version, 'promoted', { ...first.data, hold: true });
    await env.worker.promote(TENANT, RUN);
    expect(await states(env)).toEqual({ [uid(1)]: 'promoted', [uid(2)]: 'promoted' });
  });

  test('a model failure, a bad target and a missing model port all fall back to ADD', async () => {
    const failing = setup({ answer: () => { throw new Error('PROVIDER_FAILED'); } }); await failing.run();
    await failing.seed(uid(1), { text: 'a', subjects: ['npm:zod'] }); await failing.seed(...pendingFor(2, 'b', { subjects: ['npm:zod'] })); failing.scores.set('a', 0.92);
    await failing.worker.promote(TENANT, RUN);
    expect(await states(failing)).toEqual({ [uid(1)]: 'promoted', [uid(2)]: 'promoted' });
    expect(await failing.consolidation(uid(2))).toMatchObject({ decision: 'add', path: 'fallback' });
    const stray = setup({ answer: () => ({ decision: 'supersede', targetId: uid(77), model: 'm', promptVersion: 'p' }) }); await stray.run();
    await stray.seed(uid(1), { text: 'a', subjects: ['npm:zod'] }); await stray.seed(...pendingFor(2, 'b', { subjects: ['npm:zod'] })); stray.scores.set('a', 0.92);
    await stray.worker.promote(TENANT, RUN);
    expect(await states(stray)).toEqual({ [uid(1)]: 'promoted', [uid(2)]: 'promoted' });
    const bare = setup({ withConsolidate: false }); await bare.run();
    await bare.seed(uid(1), { text: 'a', subjects: ['npm:zod'] }); await bare.seed(...pendingFor(2, 'b', { subjects: ['npm:zod'] })); bare.scores.set('a', 0.92);
    await bare.worker.promote(TENANT, RUN);
    expect(await bare.consolidation(uid(2))).toMatchObject({ decision: 'add', path: 'fallback' });
  });

  test('an unavailable provider query still promotes the memory', async () => {
    const env = setup(); await env.run();
    env.memory.query = () => Promise.reject(new Error('MEMORY_UNAVAILABLE'));
    await env.seed(...pendingFor(2, 'b', { subjects: ['npm:zod'] }));
    await env.worker.promote(TENANT, RUN);
    expect(await states(env)).toEqual({ [uid(2)]: 'promoted' });
  });

  test('a replayed promotion reuses the stored decision and never calls the model again', async () => {
    const env = setup({ answer: supersedeFirst }); await env.run();
    await env.seed(uid(1), { text: 'old', subjects: ['npm:zod'] }); await env.seed(...pendingFor(2, 'new', { subjects: ['npm:zod'] })); env.scores.set('old', 0.92);
    await env.worker.promote(TENANT, RUN);
    expect(env.consolidations).toHaveLength(1);
    const promoted = await byId(env, uid(2));
    await env.records.workerWrite(TENANT, 'memory-item', uid(2), promoted.version, 'pending', { ...promoted.data, vectorState: 'pending' });
    const hostedItem = await env.memory.read(NS, uid(2));
    if (!hostedItem) throw new Error('MISSING');
    await env.memory.upsert(NS, { ...hostedItem, metadata: { ...hostedItem.metadata, state: 'pending' } });
    await env.worker.promote(TENANT, RUN);
    expect(env.consolidations).toHaveLength(1);
    expect(await states(env)).toEqual({ [uid(1)]: 'withdrawn', [uid(2)]: 'promoted' });
  });

  test('a crash between withdrawing the predecessor and promoting the successor converges on replay', async () => {
    const env = setup({ answer: supersedeFirst }); await env.run();
    await env.seed(uid(1), { text: 'old', subjects: ['npm:zod'] }); await env.seed(...pendingFor(2, 'new', { subjects: ['npm:zod'] })); env.scores.set('old', 0.92);
    await env.records.workerWrite(TENANT, 'memory-consolidation', uid(2), 0, 'supersede', { decision: 'supersede', targetId: uid(1), path: 'model', scores: [] } satisfies ConsolidationRecord);
    const old = await byId(env, uid(1));
    await env.records.workerWrite(TENANT, 'memory-item', uid(1), old.version, 'withdrawn', { ...old.data, supersededBy: uid(2), vectorState: 'remove-pending' });
    await env.worker.promote(TENANT, RUN);
    expect(await states(env)).toEqual({ [uid(1)]: 'withdrawn', [uid(2)]: 'promoted' });
    expect((await byId(env, uid(1))).data.vectorState).toBe('removed');
    expect(await env.memory.read(NS, uid(1))).toBeUndefined();
  });

  test('a run summary can retire an older run summary but never a durable fact, and facts can retire summaries', async () => {
    const env = setup({ answer: supersedeFirst }); await env.run();
    await env.seed(uid(1), { text: 'durable fact', type: 'task-fact', subjects: ['npm:zod'] });
    await env.seed(...pendingFor(2, 'episodic note', { type: 'run-summary', subjects: ['npm:zod'] }));
    env.scores.set('durable fact', 0.92);
    await env.worker.promote(TENANT, RUN);
    expect(await states(env)).toEqual({ [uid(1)]: 'promoted', [uid(2)]: 'promoted' });
    const other = setup({ answer: supersedeFirst }); await other.run();
    await other.seed(uid(1), { text: 'old episode', type: 'run-summary', subjects: ['npm:zod'] });
    await other.seed(...pendingFor(2, 'durable fact', { type: 'task-fact', subjects: ['npm:zod'] }));
    other.scores.set('old episode', 0.92);
    await other.worker.promote(TENANT, RUN);
    expect(await states(other)).toEqual({ [uid(1)]: 'withdrawn', [uid(2)]: 'promoted' });
  });

  test('candidates from the same run, another owner, an expired record or a missing SQL record never count', async () => {
    const env = setup({ answer: noopFirst }); await env.run();
    await env.seed(uid(1), { text: 'same run', subjects: ['npm:zod'], sourceId: `input:${RUN}` });
    await env.seed(uid(3), { text: 'other owner', subjects: ['npm:zod'], ownerId: 'someone-else' });
    await env.seed(uid(4), { text: 'expired', subjects: ['npm:zod'], expiresAt: iso(-1) });
    await env.seed(uid(5), { text: 'ghost', subjects: ['npm:zod'], skipSql: true });
    await env.seed(...pendingFor(2, 'fresh', { subjects: ['npm:zod'] }));
    for (const text of ['same run', 'other owner', 'expired', 'ghost']) env.scores.set(text, 0.99);
    await env.worker.promote(TENANT, RUN);
    expect((await byId(env, uid(2))).state).toBe('promoted');
    expect(env.consolidations).toHaveLength(0);
  });

  test('V1 items without a schema version are promoted without consolidation', async () => {
    const env = setup(); await env.run();
    await env.seed(uid(1), { text: 'legacy', legacy: true, state: 'pending', sourceId: `input:${RUN}` });
    await env.worker.promote(TENANT, RUN);
    expect(await states(env)).toEqual({ [uid(1)]: 'promoted' });
    expect(env.queries).toHaveLength(0);
    expect(await env.consolidation(uid(1))).toBeUndefined();
  });

  test('a provider failure while promoting marks the item failed instead of losing the run', async () => {
    const env = setup(); await env.run();
    await env.seed(...pendingFor(2, 'b', { subjects: ['npm:zod'] }));
    env.memory.read = () => Promise.resolve(undefined);
    await env.worker.promote(TENANT, RUN);
    expect(await byId(env, uid(2))).toMatchObject({ state: 'failed', data: { failure: 'HOSTED_ITEM_MISSING' } });
  });

  test('the consolidation record holds no memory text', async () => {
    const env = setup({ answer: noopFirst }); await env.run();
    await env.seed(uid(1), { text: 'SECRET_MARKER old', subjects: ['npm:zod'] }); await env.seed(...pendingFor(2, 'SECRET_MARKER new', { subjects: ['npm:zod'] })); env.scores.set('SECRET_MARKER old', 0.92);
    await env.worker.promote(TENANT, RUN);
    expect(JSON.stringify(await env.consolidation(uid(2)))).not.toContain('SECRET_MARKER');
  });
});

describe('Phase 4: retrieval quality', () => {
  const recall = async (env: Env) => { await env.run({ status: 'running', history: completedHistory.slice(0, 2), outputs: { agent: {} } }); await env.worker.step(TENANT, RUN, DEFINITION, 'recall'); const run = await readRun(env.records, RUN); return (run.data.outputs['recall'] as { memory: { status: string; items: Record<string, unknown>[] } }).memory; };

  test('ranking combines relevance, recency and type deterministically', async () => {
    const ranked = async () => {
      const env = setup();
      await env.seed(uid(1), { text: 'old fact', observedAt: iso(-90), subjects: ['npm:a'] });
      await env.seed(uid(2), { text: 'fresh fact', observedAt: iso(-1), subjects: ['npm:b'] });
      await env.seed(uid(3), { text: 'fresh episode', type: 'run-summary', observedAt: iso(-1), subjects: ['npm:c'] });
      await env.seed(uid(4), { text: 'preference', type: 'stated-preference', observedAt: iso(-400), subjects: ['npm:d'], ownerId: 'webhook:test' });
      await env.seed(uid(5), { text: 'legacy fact', legacy: true, observedAt: iso(-1) });
      for (const text of ['old fact', 'fresh fact', 'fresh episode', 'preference', 'legacy fact']) env.scores.set(text, 0.9);
      return (await recall(env)).items.map((item) => item['text']);
    };
    const order = await ranked();
    expect(order).toEqual(['preference', 'fresh fact', 'fresh episode', 'legacy fact', 'old fact']);
    expect(await ranked()).toEqual(order);
  });

  test('relevance still wins when it is far apart', async () => {
    const env = setup();
    await env.seed(uid(1), { text: 'relevant but older', observedAt: iso(-30), subjects: ['npm:a'] });
    await env.seed(uid(2), { text: 'recent but unrelated', observedAt: iso(0), subjects: ['npm:b'] });
    env.scores.set('relevant but older', 0.99); env.scores.set('recent but unrelated', 0.3);
    expect((await recall(env)).items.map((item) => item['text'])).toEqual(['relevant but older', 'recent but unrelated']);
  });

  test('ties break by observation time then id', async () => {
    const env = setup();
    await env.seed(uid(2), { text: 'b', observedAt: '2026-01-01T00:00:00.000Z', type: 'stated-preference', ownerId: 'webhook:test' });
    await env.seed(uid(1), { text: 'a', observedAt: '2026-01-01T00:00:00.000Z', type: 'stated-preference', ownerId: 'webhook:test' });
    await env.seed(uid(3), { text: 'c', observedAt: '2026-02-01T00:00:00.000Z', type: 'stated-preference', ownerId: 'webhook:test' });
    for (const text of ['a', 'b', 'c']) env.scores.set(text, 0.9);
    expect((await recall(env)).items.map((item) => item['id'])).toEqual([uid(3), uid(1), uid(2)]);
  });

  test('at most two items per leading subject reach the window', async () => {
    const env = setup({ limit: 5 });
    for (let n = 1; n <= 4; n += 1) { await env.seed(uid(n), { text: `zod ${String(n)}`, observedAt: iso(-n), subjects: ['npm:zod'] }); env.scores.set(`zod ${String(n)}`, 0.95); }
    await env.seed(uid(9), { text: 'lodash', observedAt: iso(-20), subjects: ['npm:lodash'] }); env.scores.set('lodash', 0.7);
    const texts = (await recall(env)).items.map((item) => item['text']);
    expect(texts).toEqual(['zod 1', 'zod 2', 'lodash']);
  });

  test('items are skipped whole at the character budget and the next one is tried', async () => {
    const env = setup({ maxChars: 260 });
    await env.seed(uid(1), { text: 'x'.repeat(400), observedAt: iso(-1), subjects: ['npm:a'] }); env.scores.set('x'.repeat(400), 0.99);
    await env.seed(uid(2), { text: 'short fact', observedAt: iso(-2), subjects: ['npm:b'] }); env.scores.set('short fact', 0.5);
    const memory = await recall(env);
    expect(memory.items.map((item) => item['text'])).toEqual(['short fact']);
    expect(first(memory.items)['label']).toBe(`[task-fact ${uid(2)} observed:${iso(-2).slice(0, 10)} subjects:npm:b source:input:earlier-${uid(2)}]`);
  });

  test('retrieval never lists the memory-item collection and reads at most three times the window', async () => {
    const env = setup({ limit: 2 });
    for (let n = 1; n <= 10; n += 1) await env.seed(uid(n), { text: `fact ${String(n)}`, observedAt: iso(-n), subjects: [`npm:s${String(n)}`] });
    let reads = 0; const store = asStore(env.records); const read = store.workerRead.bind(store);
    store.workerRead = async (tenant, kind, id) => { if (kind === 'memory-item') reads += 1; return read(tenant, kind, id); };
    await recall(env);
    expect(env.listed).not.toContain('memory-item');
    expect(env.queries.at(-1)?.topK).toBe(6);
    expect(reads).toBeLessThanOrEqual(6);
  });

  test('the Memory node query is built from the input string values', async () => {
    const env = setup({ input: { package: 'zod', purpose: 'api validation', nested: { team: 'platform' }, count: 3 } });
    await recall(env);
    expect(env.queries.at(-1)?.text).toBe('zod api validation platform');
  });

  test('the retrieval receipt records rank inputs without any text', async () => {
    const env = setup();
    await env.seed(uid(1), { text: 'SECRET_MARKER fact', observedAt: iso(-1), subjects: ['npm:a'] }); env.scores.set('SECRET_MARKER fact', 0.8);
    await recall(env);
    const receipt = first(await env.records.workerList<{ rank: Record<string, unknown>[] }>(TENANT, 'memory-retrieval'));
    expect(receipt.data.rank).toEqual([{ id: uid(1), score: 0.8, recency: expect.any(Number) as number, typeWeight: 0.9 }]);
    expect(JSON.stringify(receipt)).not.toContain('SECRET_MARKER');
  });

  test('eligibility is still rechecked against SQL: withdrawn, expired, held-pending and foreign-owner items are excluded', async () => {
    const env = setup();
    await env.seed(uid(1), { text: 'kept', subjects: ['npm:a'] });
    await env.seed(uid(2), { text: 'expired', subjects: ['npm:b'], expiresAt: iso(-1) });
    await env.seed(uid(3), { text: 'foreign', subjects: ['npm:c'], ownerId: 'someone-else', type: 'stated-preference' });
    await env.seed(uid(4), { text: 'ghost', subjects: ['npm:d'], skipSql: true });
    const withdrawn = uid(5); await env.seed(withdrawn, { text: 'withdrawn', subjects: ['npm:e'] });
    const row = await byId(env, withdrawn); await env.records.workerWrite(TENANT, 'memory-item', withdrawn, row.version, 'withdrawn', row.data);
    expect((await recall(env)).items.map((item) => item['text'])).toEqual(['kept']);
  });
});

describe('admin lifecycle with V2 items', () => {
  const service = (env: Env) => new WorkflowService(undefined as never, asStore(env.records), { start: () => Promise.resolve(), raise: () => Promise.resolve(), removeMemory: () => Promise.resolve() }, [TENANT], undefined, undefined, () => 'ready', env.memory);

  test('a tool-sourced or output-sourced item can be invalidated by its source id and an unknown prefix is refused', async () => {
    const env = setup();
    await env.seed(uid(1), { text: 'tool fact', sourceId: `tool:${RUN}:agent:c1`, subjects: ['npm:zod'] });
    await env.seed(uid(2), { text: 'output fact', sourceId: `output:${RUN}:agent`, subjects: ['npm:zod'] });
    const admin = contextFor('55555555-5555-4555-8555-555555555555');
    await service(env).invalidateMemorySource(admin, `tool:${RUN}:agent:c1`, uid(90), 'a'.repeat(64));
    expect(await states(env)).toEqual({ [uid(1)]: 'withdrawn', [uid(2)]: 'promoted' });
    await service(env).invalidateMemorySource(admin, `output:${RUN}:agent`, uid(91), 'b'.repeat(64));
    expect(await states(env)).toEqual({ [uid(1)]: 'withdrawn', [uid(2)]: 'withdrawn' });
    await expect(service(env).invalidateMemorySource(admin, 'invalid:x', uid(92), 'c'.repeat(64))).rejects.toMatchObject({ code: 'INVALID' });
  });

  test('the Studio projection exposes subjects, supersession and the consolidation decision without any text', async () => {
    const env = setup();
    await env.seed(uid(1), { text: 'SECRET_MARKER old', subjects: ['npm:zod'], observedAt: iso(-3) });
    const old = await byId(env, uid(1));
    await env.records.workerWrite(TENANT, 'memory-item', uid(1), old.version, 'withdrawn', { ...old.data, supersededBy: uid(2) });
    await env.seed(uid(2), { text: 'SECRET_MARKER new', subjects: ['npm:zod'], observedAt: iso(-1) });
    await env.records.workerWrite(TENANT, 'memory-consolidation', uid(2), 0, 'supersede', { decision: 'supersede', targetId: uid(1), path: 'model', scores: [{ id: uid(1), score: 0.9 }], corroboratedBy: ['input:x'] } satisfies ConsolidationRecord);
    const projection = await service(env).projection(contextFor('55555555-5555-4555-8555-555555555555'), 'workflow-memory-items');
    const records = projection['records'] as Record<string, unknown>[];
    expect(records.find((entry) => entry['id'] === uid(1))).toMatchObject({ state: 'withdrawn', subjects: ['npm:zod'], supersededBy: uid(2), schemaVersion: 2 });
    expect(records.find((entry) => entry['id'] === uid(2))).toMatchObject({ consolidation: { decision: 'supersede', path: 'model', targetId: uid(1), corroborations: 1 } });
    expect(JSON.stringify(projection)).not.toContain('SECRET_MARKER');
  });

  test('set-expiry may shorten a 180 day preference but never extend an item', async () => {
    const env = setup();
    await env.seed(uid(1), { text: 'preference', type: 'stated-preference', subjects: [], expiresAt: iso(170), ownerId: 'u' });
    const admin = contextFor('55555555-5555-4555-8555-555555555555'); const item = await byId(env, uid(1));
    const shortened = iso(120);
    await service(env).memoryLifecycle(admin, 'set-expiry', uid(1), item.version, uid(93), 'd'.repeat(64), undefined, shortened);
    expect((await byId(env, uid(1))).data.expiresAt).toBe(shortened);
    await expect(service(env).memoryLifecycle(admin, 'set-expiry', uid(1), item.version + 1, uid(94), 'e'.repeat(64), undefined, iso(175))).rejects.toMatchObject({ code: 'INVALID' });
  });
});
