import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { compileGraph, type CapabilityPin, type GraphDraft, type GraphNode } from './graph.js';
import type { JudgmentResult, McpPort, ModelPort, StepResult } from './runtime.js';
import { WorkflowService, deliverWebhook, webhookRunId, type Scheduler } from './service.js';
import { DEFINITION, MemoryRecords, POLICY, TENANT, asStore, contextFor, install, pinFor, readRun, shape, unusedModel, worker, type PinSpec } from './worker-harness.test-support.js';

const SECRET = 'signing-secret';
const APPROVER = '55555555-5555-4555-8555-555555555555';
const REFUND: PinSpec = { risk: 'R3', capability: 'issue_refund', inputSchema: shape({ orderId: { type: 'string' }, amount: { type: 'number' } }), outputSchema: shape({ result: { type: 'string' } }) };
const LABEL: PinSpec = { risk: 'R1', capability: 'label_ticket', inputSchema: shape({ label: { type: 'string' }, priority: { type: 'string' } }), outputSchema: shape({ result: { type: 'string' } }) };
const JUDGE_POLICY = { ...POLICY, toolRounds: 0, effects: 0, tokens: 8000, cost: 0.01 };

const node = (id: string, kind: string, config: Record<string, unknown>): GraphNode => ({ id, kind, title: id, detail: '', x: 0, y: 0, instructions: '', config });
const mcp = (id: string, spec: PinSpec, args: Record<string, unknown>): GraphNode => { const pin = pinFor(id, spec); return node(id, 'mcp', { installationId: pin.installationId, capability: spec.capability, manifestDigest: pin.manifestDigest, grantId: pin.grantId, target: 'crm', arguments: args, policy: POLICY }); };
const edge = (from: string, to: string, branch?: 'true' | 'false') => ({ id: `${from}-${to}-${String(branch)}`, from, to, ...(branch ? { branch } : {}) });
const when = (id: string, field: string, equals: string): GraphNode => node(id, 'condition', { source: 'triage', field, equals });

const graph = (): GraphDraft => ({ kind: 'graph-v1', nodes: [
  node('start', 'trigger', { mode: 'webhook', inputSchema: shape({ body: { type: 'string' }, orderId: { type: 'string' }, amount: { type: 'number' }, customerId: { type: 'string' } }) }),
  node('recall', 'memory', { limit: 3, maxChars: 1500, policy: POLICY }),
  node('triage', 'judgment', {
    provider: 'openrouter', openRouterOptIn: true, model: 'typesafe/jev-1.13',
    questions: {
      intent: { type: 'choice', instructions: 'What does the customer want?', criteria: { refund: 'Money back', bug: 'A defect', account: 'Account help', none: 'Nothing fits' } },
      refund_ask: { type: 'noul', instructions: 'Does the customer explicitly ask for money back?', thresholds: { act: 0.9, review: 0.7 } },
      abusive: { type: 'noul', instructions: 'Is the message abusive?' },
      urgency: { type: 'score', instructions: 'How urgent?', criteria: ['Can wait', 'Today', 'Now'], gate: false },
    },
    state: { ticket: '$input.body', history: '$node.recall.memory' }, thresholds: { act: 0.85, review: 0.6 }, policy: JUDGE_POLICY,
  }),
  when('is_refund', 'intent_answer', 'refund'), when('asked', 'refund_ask_answer', 'yes'), when('confident', 'band', 'act'),
  node('gate', 'approval', { timeoutMs: 600000, disclose: ['orderId', 'amount'] }),
  mcp('issue', REFUND, { orderId: '$input.orderId', amount: '$input.amount' }),
  mcp('label', LABEL, { label: '$node.triage.intent_answer', priority: '$node.triage.urgency_answer' }),
  node('refunded', 'end', { outcome: 'refunded' }), node('routed', 'end', { outcome: 'routed' }), node('human', 'end', { outcome: 'needs-human' }),
], edges: [
  edge('start', 'recall'), edge('recall', 'triage'), edge('triage', 'is_refund'),
  edge('is_refund', 'asked', 'true'), edge('is_refund', 'confident', 'false'),
  edge('asked', 'gate', 'true'), edge('asked', 'human', 'false'),
  edge('gate', 'issue'), edge('issue', 'refunded'),
  edge('confident', 'label', 'true'), edge('confident', 'human', 'false'), edge('label', 'routed'),
] });

const answers = (patch: Record<string, unknown> = {}) => ({
  intent: { type: 'choice', choice: 'refund', confidence: 0.88, probabilities: { refund: 0.91, bug: 0.06, none: 0.03 } },
  refund_ask: { type: 'noul', noul: 0.95 },
  abusive: { type: 'noul', noul: 0.04 },
  urgency: { type: 'score', score: 1, confidence: 0.55, probabilities: { '1': 0.62, '0': 0.2, '2': 0.18 } },
  ...patch,
});

const start = async (judgeAnswers: Record<string, unknown>) => {
  const records = new MemoryRecords(); const pins: CapabilityPin[] = [pinFor('issue', REFUND), pinFor('label', LABEL)];
  install(records, pins);
  const definition = await compileGraph(DEFINITION, 1, graph(), pins);
  records.published.set(`${TENANT}:${DEFINITION}`, { id: DEFINITION, draftId: DEFINITION, draftRevision: 1, digest: definition.digest, definition });
  await records.workerWrite(TENANT, 'webhook-credential', DEFINITION, 0, 'active', { definitionId: DEFINITION, secret: SECRET, enabled: true, rotatedAt: '2026-01-01T00:00:00.000Z' });
  const started: string[] = []; const scheduler: Scheduler = { start: (runId) => { started.push(runId); return Promise.resolve(); }, raise: () => Promise.resolve() };
  const eventId = randomUUID(); const timestamp = new Date().toISOString();
  const body = Buffer.from(JSON.stringify({ body: 'Please refund order A-1, it never arrived', orderId: 'A-1', amount: 42, customerId: 'c-9' }));
  const signature = `sha256=${createHmac('sha256', SECRET).update(Buffer.concat([Buffer.from(`${TENANT}:${DEFINITION}:${timestamp}:${eventId}:`), body])).digest('hex')}`;
  const delivery = await deliverWebhook(asStore(records), scheduler, { tenantId: TENANT, definitionId: DEFINITION, eventId, timestamp, signature, body });
  expect(delivery).toEqual({ outcome: 'accepted', runId: webhookRunId(TENANT, DEFINITION, eventId) });
  const runId = webhookRunId(TENANT, DEFINITION, eventId);
  const judge = vi.fn((): Promise<JudgmentResult> => Promise.resolve({ answers: judgeAnswers as JudgmentResult['answers'], model: 'typesafe/jev-1.13', requestId: 'gen-dec-1', tokens: 450, cost: 0.0001 }));
  const model = { ...unusedModel, judge } as unknown as ModelPort;
  const invoke = vi.fn(() => Promise.resolve({ outcome: 'succeeded' as const, output: { result: 'ok' } }));
  const w = worker(records, model, { invoke } satisfies McpPort);
  const scheduled = { start: () => Promise.resolve(), raise: () => Promise.resolve() } satisfies Scheduler;
  const service = new WorkflowService({} as never, asStore(records), scheduled);
  const drive = async (from: string): Promise<{ last: StepResult; visited: string[] }> => {
    const visited: string[] = []; let id: string | undefined = from; let last: StepResult = {};
    while (id !== undefined) { visited.push(id); last = await w.step(TENANT, runId, DEFINITION, id); id = last.next; }
    return { last, visited };
  };
  return { records, runId, judge, invoke, drive, service, started };
};

test('the R3 refund waits for approval with the Judgment fact visible, then runs after an approve', async () => {
  const flow = await start(answers());
  const { last, visited } = await flow.drive('start');
  expect(last.waiting).toBe('approval');
  expect(visited).toEqual(['start', 'recall', 'triage', 'is_refund', 'asked', 'gate']);
  expect(flow.judge).toHaveBeenCalledTimes(1);
  const waiting = await readRun(flow.records, flow.runId);
  const pending = waiting.data.waiting;
  if (!pending) throw new Error('not waiting');
  expect(waiting.data.status).toBe('waiting-approval');
  const facts = (pending.review?.facts ?? []) as { name: string; value: string }[];
  const fact = facts.find((item) => item.name === 'judgment:triage');
  expect(facts.map((fact) => fact.name)).toEqual(['orderId', 'amount', 'judgment:triage']);
  expect(fact?.value.split('\n')).toEqual([
    'intent: refund · probability 0.91 · confidence 0.88 · band act',
    'refund_ask: yes · probability 0.95 · confidence 0.95 · band act',
    'abusive: no · probability 0.04 · confidence 0.96 · band act',
    'urgency: 1 · probability 0.62 · confidence 0.55 · band escalate · not gating',
    'overall act · typesafe/jev-1.13',
  ]);
  expect(flow.invoke).not.toHaveBeenCalled();
  await flow.service.approve(contextFor(APPROVER), flow.runId, pending.bindingDigest, 'approve', waiting.version, '99999999-9999-4999-8999-000000000001', 'digest');
  const approved = await readRun(flow.records, flow.runId);
  expect(approved.data.decisions?.['gate']).toMatchObject({ outcome: 'approve', facts: expect.arrayContaining([{ name: 'judgment:triage', value: fact?.value }]) as unknown });
  const after = await flow.drive('issue');
  expect(after.visited).toEqual(['issue', 'refunded']);
  expect(flow.invoke).toHaveBeenCalledWith(expect.anything(), 'issue_refund', { orderId: 'A-1', amount: 42 }, expect.any(String), expect.any(String));
  const done = (await readRun(flow.records, flow.runId)).data;
  expect(done.status).toBe('completed');
  expect(done.outcomeLabel).toBe('refunded');
});

test('the R1 label path completes by itself when the overall band is act', async () => {
  const flow = await start(answers({ intent: { type: 'choice', choice: 'bug', confidence: 0.9, probabilities: { bug: 0.92, refund: 0.05 } } }));
  const { visited } = await flow.drive('start');
  expect(visited).toEqual(['start', 'recall', 'triage', 'is_refund', 'confident', 'label', 'routed']);
  expect(flow.invoke).toHaveBeenCalledWith(expect.anything(), 'label_ticket', { label: 'bug', priority: '1' }, expect.any(String), expect.any(String));
  const done = (await readRun(flow.records, flow.runId)).data;
  expect(done.status).toBe('completed');
  expect(done.outcomeLabel).toBe('routed');
  expect(done.usage).toMatchObject({ tokens: 450, modelCalls: 1 });
});

test('a low-confidence answer ends at needs-human without any effect', async () => {
  const flow = await start(answers({ intent: { type: 'choice', choice: 'bug', confidence: 0.4, probabilities: { bug: 0.5, refund: 0.3 } } }));
  const { visited } = await flow.drive('start');
  expect(visited).toEqual(['start', 'recall', 'triage', 'is_refund', 'confident', 'human']);
  expect(flow.invoke).not.toHaveBeenCalled();
  expect((await readRun(flow.records, flow.runId)).data.outcomeLabel).toBe('needs-human');
});

test('a refund the customer did not explicitly ask for ends at needs-human', async () => {
  const flow = await start(answers({ refund_ask: { type: 'noul', noul: 0.1 } }));
  const { visited } = await flow.drive('start');
  expect(visited.at(-1)).toBe('human');
  expect(flow.invoke).not.toHaveBeenCalled();
});
