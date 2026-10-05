import { afterEach, expect, test, vi } from 'vitest';
import { observe, resetObservers } from '../../telemetry/src/observe.test-support.js';
import type { CompiledNode } from './graph.js';
import type { JudgmentRequest, JudgmentResult, ModelPort } from './runtime.js';
import { DEFINITION, MemoryRecords, POLICY, TENANT, idle, publish, readRun, seedRun, unusedModel, worker } from './worker-harness.test-support.js';

const NODE_POLICY = { ...POLICY, toolRounds: 0, effects: 0, tokens: 8000, cost: 0.01, attempts: 1 };
const RUN = '88888888-8888-4888-8888-888888888888';
const SECOND_RUN = '99999999-9999-4999-8999-999999999999';

const questions = {
  team: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'Charges', none: 'Other' }, thresholds: { act: 0.9, review: 0.5 } },
  refund: { type: 'noul', instructions: 'Wants money back?' },
  urgency: { type: 'score', instructions: 'How urgent?', criteria: ['Low', 'High'], gate: false },
  abusive: { type: 'noul', instructions: 'Abusive?' },
};
const config = (patch: Record<string, unknown> = {}) => ({
  provider: 'openrouter', openRouterOptIn: true, model: 'typesafe/jev-1.13', questions,
  state: { ticket: '$input.body', history: '$node.recall.memory', channel: 'email' },
  thresholds: { act: 0.85, review: 0.6 }, policy: NODE_POLICY, ...patch,
});
const answers = {
  team: { type: 'choice', choice: 'billing', confidence: 0.95, probabilities: { billing: 0.95, none: 0.05 } },
  refund: { type: 'noul', noul: 0.9 },
  urgency: { type: 'score', score: 0.2, confidence: 0.3, probabilities: { '0': 0.7, '1': 0.3 } },
  abusive: { type: 'noul', noul: 0.04 },
};
const result = (patch: Partial<JudgmentResult> = {}): JudgmentResult => ({ answers, model: 'typesafe/jev-1.13', requestId: 'gen-dec-1', tokens: 420, cost: 0.0001, promptTokens: 400, completionTokens: 20, ...patch });

const setup = async (nodeConfig: Record<string, unknown> = config(), patch: Record<string, unknown> = {}) => {
  const records = new MemoryRecords();
  const nodes: CompiledNode[] = [
    { id: 'trigger', kind: 'trigger', config: {}, next: 'triage' },
    { id: 'triage', kind: 'judgment', config: nodeConfig, next: 'end' },
    { id: 'end', kind: 'end', config: {}, next: null },
  ];
  const definition = publish(records, nodes, []);
  await seedRun(records, definition, RUN, { body: 'refund me please' }, { outputs: { recall: { memory: { status: 'success', items: [{ id: 'm1', text: 'two refunds' }] } } }, ...patch });
  return { records, definition };
};
const modelWith = (judge?: (request: JudgmentRequest) => Promise<JudgmentResult>): ModelPort => ({ ...unusedModel, ...(judge ? { judge } : {}) }) as unknown as ModelPort;
const step = (records: MemoryRecords, model: ModelPort, runId = RUN) => worker(records, model, idle).step(TENANT, runId, DEFINITION, 'triage');

afterEach(() => { resetObservers(); vi.restoreAllMocks(); });

test('a 4-question node makes one judge call and completes with flat output, usage and history detail', async () => {
  const { records } = await setup();
  const judge = vi.fn().mockResolvedValue(result());
  expect(await step(records, modelWith(judge))).toEqual({ next: 'end' });
  expect(judge).toHaveBeenCalledTimes(1);
  const request = judge.mock.calls[0]![0] as JudgmentRequest;
  expect(request).toMatchObject({ tenantId: TENANT, model: 'typesafe/jev-1.13', state: { ticket: 'refund me please', history: { status: 'success', items: [{ id: 'm1', text: 'two refunds' }] }, channel: 'email' }, telemetry: { feature: 'judgment', runId: RUN, nodeId: 'triage', attempt: 1 } });
  expect(request.milliseconds).toBeGreaterThan(0);
  expect(Object.keys(request.questions)).toEqual(['team', 'refund', 'urgency', 'abusive']);
  expect(JSON.stringify(request.questions)).not.toMatch(/thresholds|gate/u);
  const run = (await readRun(records, RUN)).data;
  expect(run.outputs['triage']).toMatchObject({
    team_answer: 'billing', team_probability: 0.95, team_confidence: 0.95, team_band: 'act',
    refund_answer: 'yes', refund_band: 'act', urgency_answer: '0', urgency_score: 0.2, urgency_band: 'escalate',
    abusive_answer: 'no', abusive_confidence: 0.96, abusive_band: 'act',
    band: 'act', model: 'typesafe/jev-1.13', requestId: 'gen-dec-1',
  });
  expect(run.usage).toEqual({ tokens: 420, cost: 0.0001, modelCalls: 1 });
  expect(run.history.map((item) => [item.nodeId, item.state, item.detail])).toEqual([['triage', 'attempted', 'openrouter:typesafe/jev-1.13:1:succeeded'], ['triage', 'completed', 'openrouter:typesafe/jev-1.13:420:0.0001']]);
});

test('re-stepping a completed Judgment makes no call', async () => {
  const { records } = await setup();
  const judge = vi.fn().mockResolvedValue(result());
  await step(records, modelWith(judge));
  expect(await step(records, modelWith(judge))).toEqual({ next: 'end' });
  expect(judge).toHaveBeenCalledTimes(1);
});

test('the band counter is incremented once per question without question ids', async () => {
  const { points, everything } = observe();
  const { records } = await setup();
  await step(records, modelWith(vi.fn().mockResolvedValue(result())));
  const counted = (await points('workflow.judgment.bands')).map((point) => ({ band: point.attributes['band'], type: point.attributes['question_type'], value: point.value })).sort((a, b) => `${a.band}${a.type}`.localeCompare(`${b.band}${b.type}`));
  expect(counted).toEqual([{ band: 'act', type: 'choice', value: 1 }, { band: 'act', type: 'noul', value: 2 }, { band: 'escalate', type: 'score', value: 1 }]);
  expect(await everything()).not.toContain('"team"');
});

test('a failed call is retried and the second attempt succeeds', async () => {
  const { records } = await setup(config({ policy: { ...NODE_POLICY, attempts: 2 } }));
  const judge = vi.fn().mockRejectedValueOnce(new Error('PROVIDER_FAILED')).mockResolvedValueOnce(result());
  expect(await step(records, modelWith(judge))).toEqual({ next: 'end' });
  const run = (await readRun(records, RUN)).data;
  expect(judge).toHaveBeenCalledTimes(2);
  expect(run.history.map((item) => item.detail)).toEqual(['openrouter:typesafe/jev-1.13:1:failed', 'openrouter:typesafe/jev-1.13:2:succeeded', 'openrouter:typesafe/jev-1.13:420:0.0001']);
  expect(run.usage?.modelCalls).toBe(1);
});

test('exhausted attempts fail the node with INVALID_MODEL_OUTPUT and repeated failure opens the circuit', async () => {
  const { points } = observe();
  const { records } = await setup(config({ policy: { ...NODE_POLICY, attempts: 3 } }));
  const judge = vi.fn().mockRejectedValue(new Error('PROVIDER_FAILED'));
  expect(await step(records, modelWith(judge))).toEqual({ failed: true });
  expect(judge).toHaveBeenCalledTimes(3);
  const failed = (await readRun(records, RUN)).data;
  expect(failed.status).toBe('failed');
  expect(failed.history.at(-1)).toMatchObject({ state: 'failed', detail: 'INVALID_MODEL_OUTPUT' });
  await seedRun(records, (await records.workerDefinition(TENANT, DEFINITION))!.definition, SECOND_RUN, { body: 'again' }, { outputs: { recall: { memory: { status: 'empty', items: [] } } } });
  const blocked = await step(records, modelWith(judge), SECOND_RUN);
  expect(blocked).toMatchObject({ waiting: 'circuit' });
  expect(judge).toHaveBeenCalledTimes(3);
  expect((await points('workflow.circuit.transitions')).map((point) => [point.attributes['kind'], point.attributes['state']])).toEqual([['judgment', 'open']]);
});

test.each([
  ['tokens', { tokens: 9000 }],
  ['cost', { cost: 1 }],
  ['unknown tokens', { tokens: Infinity }],
])('exceeding the %s budget fails with BUDGET_EXCEEDED', async (_name, patch) => {
  const { records } = await setup();
  expect(await step(records, modelWith(vi.fn().mockResolvedValue(result(patch))))).toEqual({ failed: true });
  expect((await readRun(records, RUN)).data.history.at(-1)).toMatchObject({ state: 'failed', detail: 'BUDGET_EXCEEDED' });
});

test('state that cannot fit the token policy fails before any call', async () => {
  const { records } = await setup(config({ policy: { ...NODE_POLICY, tokens: 50 } }));
  const judge = vi.fn();
  expect(await step(records, modelWith(judge))).toEqual({ failed: true });
  expect(judge).not.toHaveBeenCalled();
  expect((await readRun(records, RUN)).data.history.at(-1)).toMatchObject({ detail: 'JUDGMENT_STATE_TOO_LARGE' });
});

test('a worker without judge fails with PROVIDER_NOT_READY', async () => {
  const { records } = await setup();
  expect(await step(records, modelWith())).toEqual({ failed: true });
  expect((await readRun(records, RUN)).data.history.at(-1)).toMatchObject({ detail: 'PROVIDER_NOT_READY' });
});

test.each([
  ['an answer outside the criteria', { ...answers, team: { ...answers.team, choice: 'sales' } }],
  ['a missing question', { team: answers.team, refund: answers.refund, urgency: answers.urgency }],
  ['an extra question', { ...answers, extra: { type: 'noul', noul: 0.5 } }],
])('%s fails the whole step with INVALID_MODEL_OUTPUT and writes no output', async (_name, bad) => {
  const { records } = await setup();
  expect(await step(records, modelWith(vi.fn().mockResolvedValue(result({ answers: bad as never }))))).toEqual({ failed: true });
  const run = (await readRun(records, RUN)).data;
  expect(run.history.at(-1)).toMatchObject({ detail: 'INVALID_MODEL_OUTPUT' });
  expect(run.outputs['triage']).toBeUndefined();
});

test('an unresolvable state mapping fails with INVALID_MAPPING before any call', async () => {
  const { records } = await setup(config({ state: { ticket: '$input.missing' } }));
  const judge = vi.fn();
  expect(await step(records, modelWith(judge))).toEqual({ failed: true });
  expect(judge).not.toHaveBeenCalled();
  expect((await readRun(records, RUN)).data.history.at(-1)).toMatchObject({ detail: 'INVALID_MAPPING' });
});
