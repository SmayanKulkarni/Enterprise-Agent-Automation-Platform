import { expect, test } from 'vitest';
import { bandOf, evaluateJudgment, judgmentFacts, judgmentAnswers, judgmentConfigValid, judgmentOutputSchema, normaliseAnswer, normaliseAnswers, type JudgmentConfig, type JudgmentQuestion } from './judgment.js';
import { POLICY } from './worker-harness.test-support.js';

const defined = <T>(value: T | undefined): T => { if (value === undefined) throw new Error('missing'); return value; };
const NODE_POLICY = { ...POLICY, toolRounds: 0, effects: 0, tokens: 8000 };
const config = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  provider: 'openrouter', openRouterOptIn: true, model: 'typesafe/jev-1.13',
  questions: {
    team: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'Charges', technical: 'Errors', none: 'Other' } },
    refund_requested: { type: 'noul', instructions: 'Wants money back?', thresholds: { act: 0.9, review: 0.7 } },
    urgency: { type: 'score', instructions: 'How urgent?', criteria: ['Low', 'Mid', 'High'], gate: false },
  },
  state: { ticket: '$input.body', history: '$node.recall.memory', channel: 'email' },
  thresholds: { act: 0.85, review: 0.6 },
  policy: NODE_POLICY,
  ...patch,
});
const node = (cfg: Record<string, unknown> = config(), instructions = '') => ({ id: 'triage', kind: 'judgment', instructions, config: cfg });
const valid = (cfg: Record<string, unknown>, instructions = ''): boolean => judgmentConfigValid(node(cfg, instructions));
const questions = (cfg: Record<string, unknown> = config()) => cfg['questions'] as Record<string, Record<string, unknown>>;
const choice = (criteria: Record<string, string>) => ({ type: 'choice', instructions: 'Pick', criteria });

test('accepts a well-formed Judgment', () => {
  expect(valid(config())).toBe(true);
});

test('rejects non-empty node instructions, extra config fields and bad providers', () => {
  expect(valid(config(), 'text')).toBe(false);
  expect(valid(config({ extra: 1 }))).toBe(false);
  expect(valid(config({ provider: 'azure-openai' }))).toBe(false);
  expect(valid(config({ openRouterOptIn: false }))).toBe(false);
});

test('rejects aliases and models without a vendor prefix', () => {
  expect(valid(config({ model: '~typesafe/jev-latest' }))).toBe(false);
  expect(valid(config({ model: 'jev' }))).toBe(false);
});

test('question count is limited to 1 through 16 and ids must match the regex', () => {
  const many = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`q${String(index)}`, choice({ a: 'A', b: 'B' })]));
  expect(valid(config({ questions: {} }))).toBe(false);
  expect(valid(config({ questions: many(1) }))).toBe(true);
  expect(valid(config({ questions: many(16) }))).toBe(true);
  expect(valid(config({ questions: many(17) }))).toBe(false);
  expect(valid(config({ questions: { Team: choice({ a: 'A', b: 'B' }) } }))).toBe(false);
  expect(valid(config({ questions: { '1team': choice({ a: 'A', b: 'B' }) } }))).toBe(false);
  expect(valid(config({ questions: { [`a${'b'.repeat(32)}`]: choice({ a: 'A', b: 'B' }) } }))).toBe(false);
});

test('total criteria across questions is at most 512', () => {
  const keys = (count: number, prefix: string) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`${prefix}${String(index)}`, 'x']));
  expect(valid(config({ questions: { a: choice(keys(255, 'k')), b: choice(keys(255, 'k')), c: choice(keys(2, 'k')) } }))).toBe(true);
  expect(valid(config({ questions: { a: choice(keys(255, 'k')), b: choice(keys(255, 'k')), c: choice(keys(3, 'k')) } }))).toBe(false);
});

test('choice criteria need 2 to 255 valid keys with non-empty descriptions', () => {
  expect(valid(config({ questions: { a: choice({ only: 'x' }) } }))).toBe(false);
  expect(valid(config({ questions: { a: choice({ 'Bad Key': 'x', b: 'y' }) } }))).toBe(false);
  expect(valid(config({ questions: { a: choice({ a: '', b: 'y' }) } }))).toBe(false);
  expect(valid(config({ questions: { a: choice({ a: 'x'.repeat(2001), b: 'y' }) } }))).toBe(false);
});

test('score criteria need 2 to 10 level descriptions', () => {
  const score = (criteria: unknown) => ({ a: { type: 'score', instructions: 'Rate', criteria } });
  expect(valid(config({ questions: score(['one']) }))).toBe(false);
  expect(valid(config({ questions: score(['one', 'two']) }))).toBe(true);
  expect(valid(config({ questions: score(Array.from({ length: 10 }, () => 'x')) }))).toBe(true);
  expect(valid(config({ questions: score(Array.from({ length: 11 }, () => 'x')) }))).toBe(false);
  expect(valid(config({ questions: score({ a: 'x', b: 'y' }) }))).toBe(false);
});

test('noul criteria are optional but need both descriptions when present', () => {
  const noul = (extra: Record<string, unknown>) => ({ a: { type: 'noul', instructions: 'Is it?', ...extra } });
  expect(valid(config({ questions: noul({}) }))).toBe(true);
  expect(valid(config({ questions: noul({ criteria: { true: 'yes', false: 'no' } }) }))).toBe(true);
  expect(valid(config({ questions: noul({ criteria: { true: 'yes' } }) }))).toBe(false);
  expect(valid(config({ questions: noul({ criteria: ['a', 'b'] }) }))).toBe(false);
});

test('question fields are restricted and instructions trimmed length is checked', () => {
  expect(valid(config({ questions: { a: { ...choice({ a: 'A', b: 'B' }), extra: true } } }))).toBe(false);
  expect(valid(config({ questions: { a: { ...choice({ a: 'A', b: 'B' }), instructions: '   ' } } }))).toBe(false);
  expect(valid(config({ questions: { a: { ...choice({ a: 'A', b: 'B' }), instructions: 'x'.repeat(4001) } } }))).toBe(false);
  expect(valid(config({ questions: { a: { ...choice({ a: 'A', b: 'B' }), gate: 'no' } } }))).toBe(false);
  expect(valid(config({ questions: { a: { type: 'other', instructions: 'x' } } }))).toBe(false);
});

test('thresholds need 0 <= review <= act <= 1 for the default and each override', () => {
  expect(valid(config({ thresholds: { act: 0.6, review: 0.6 } }))).toBe(true);
  expect(valid(config({ thresholds: { act: 0.5, review: 0.6 } }))).toBe(false);
  expect(valid(config({ thresholds: { act: 1.1, review: 0.6 } }))).toBe(false);
  expect(valid(config({ thresholds: { act: 0.9 } }))).toBe(false);
  expect(valid(config({ thresholds: { act: Number.NaN, review: 0.1 } }))).toBe(false);
  const overridden = config();
  questions(overridden)['team'] = { ...choice({ a: 'A', b: 'B' }), thresholds: { act: 0.4, review: 0.5 } };
  expect(valid(overridden)).toBe(false);
});

test('state needs 1 to 16 keys with mappings or literals that do not start with $', () => {
  expect(valid(config({ state: {} }))).toBe(false);
  expect(valid(config({ state: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`k${String(index)}`, 'x'])) }))).toBe(false);
  expect(valid(config({ state: { '1bad': 'x' } }))).toBe(false);
  expect(valid(config({ state: { a: '$bogus' } }))).toBe(false);
  expect(valid(config({ state: { a: 5 } }))).toBe(false);
  expect(valid(config({ state: { a: 'x'.repeat(4001) } }))).toBe(false);
  expect(valid(config({ state: { a: '$input.body', b: '$node.step.field', c: 'literal' } }))).toBe(true);
});

test('policy must allow no tool rounds or effects and at least one token', () => {
  expect(valid(config({ policy: { ...NODE_POLICY, toolRounds: 1 } }))).toBe(false);
  expect(valid(config({ policy: { ...NODE_POLICY, effects: 1 } }))).toBe(false);
  expect(valid(config({ policy: { ...NODE_POLICY, tokens: 0 } }))).toBe(false);
  expect(valid(config({ policy: { milliseconds: 1 } }))).toBe(false);
});

test('output schema is flat with the documented field names', () => {
  const schema = judgmentOutputSchema(config());
  expect(Object.keys(schema.properties).sort()).toEqual([
    'band', 'model', 'probabilities', 'requestId',
    'refund_requested_answer', 'refund_requested_band', 'refund_requested_confidence', 'refund_requested_probability',
    'team_answer', 'team_band', 'team_confidence', 'team_probability',
    'urgency_answer', 'urgency_band', 'urgency_confidence', 'urgency_probability', 'urgency_score',
  ].sort());
  expect(schema.properties['team_probability']).toEqual({ type: 'number' });
  expect(schema.properties['team_answer']).toEqual({ type: 'string' });
  expect(schema.properties['probabilities']).toEqual({ type: 'object' });
  expect(schema.required).toEqual(expect.arrayContaining(['team_answer', 'team_band', 'band', 'probabilities', 'model']));
  expect(schema.required).not.toContain('urgency_score');
  expect(schema.required).not.toContain('requestId');
  expect(schema.additionalProperties).toBe(false);
});

test('allowed answers per type', () => {
  expect(judgmentAnswers(choice({ b: 'B', a: 'A' }) as never)).toEqual(['b', 'a']);
  expect(judgmentAnswers({ type: 'score', instructions: 'x', criteria: ['a', 'b', 'c'] })).toEqual(['0', '1', '2']);
  expect(judgmentAnswers({ type: 'noul', instructions: 'x' })).toEqual(['yes', 'no']);
});

const team: JudgmentQuestion = { type: 'choice', instructions: 'x', criteria: { billing: 'a', technical: 'b', none: 'c' } };
const urgency: JudgmentQuestion = { type: 'score', instructions: 'x', criteria: ['a', 'b', 'c'] };
const flag: JudgmentQuestion = { type: 'noul', instructions: 'x' };

test('choice answers are read by key regardless of probability order', () => {
  expect(normaliseAnswer(team, { type: 'choice', choice: 'technical', confidence: 0.7, probabilities: { none: 0.1, technical: 0.7, billing: 0.2 } })).toEqual({ answer: 'technical', probability: 0.7, confidence: 0.7, probabilities: { none: 0.1, technical: 0.7, billing: 0.2 } });
});

test('choice rejects an answer or probability key outside the criteria, bad numbers and a type mismatch', () => {
  const base = { type: 'choice', choice: 'billing', confidence: 0.9, probabilities: { billing: 0.9 } };
  expect(() => normaliseAnswer(team, { ...base, choice: 'other' })).toThrow('INVALID_MODEL_OUTPUT');
  expect(() => normaliseAnswer(team, { ...base, probabilities: { billing: 0.9, other: 0.1 } })).toThrow('INVALID_MODEL_OUTPUT');
  expect(() => normaliseAnswer(team, { ...base, probabilities: { technical: 0.9 } })).toThrow('INVALID_MODEL_OUTPUT');
  expect(() => normaliseAnswer(team, { ...base, confidence: 1.2 })).toThrow('INVALID_MODEL_OUTPUT');
  expect(() => normaliseAnswer(team, { ...base, confidence: 'high' })).toThrow('INVALID_MODEL_OUTPUT');
  expect(() => normaliseAnswer(team, { ...base, probabilities: { billing: Number.NaN } })).toThrow('INVALID_MODEL_OUTPUT');
  expect(() => normaliseAnswer(team, { ...base, type: 'score' })).toThrow('INVALID_MODEL_OUTPUT');
});

test('score takes the most probable level, ties go to the lower index, and keeps the weighted score', () => {
  expect(normaliseAnswer(urgency, { type: 'score', score: 1.4, confidence: 0.8, probabilities: { '2': 0.3, '1': 0.6, '0': 0.1 } })).toEqual({ answer: '1', probability: 0.6, confidence: 0.8, probabilities: { '2': 0.3, '1': 0.6, '0': 0.1 }, score: 1.4 });
  expect(normaliseAnswer(urgency, { type: 'score', score: 1, confidence: 0.5, probabilities: { '0': 0.4, '2': 0.4 } }).answer).toBe('0');
});

test('score rejects out-of-range values, unknown levels and empty probabilities', () => {
  const base = { type: 'score', score: 1, confidence: 0.5, probabilities: { '1': 0.5 } };
  expect(() => normaliseAnswer(urgency, { ...base, score: 3 })).toThrow('INVALID_MODEL_OUTPUT');
  expect(() => normaliseAnswer(urgency, { ...base, score: -0.1 })).toThrow('INVALID_MODEL_OUTPUT');
  expect(() => normaliseAnswer(urgency, { ...base, probabilities: { '3': 0.5 } })).toThrow('INVALID_MODEL_OUTPUT');
  expect(() => normaliseAnswer(urgency, { ...base, probabilities: {} })).toThrow('INVALID_MODEL_OUTPUT');
});

test('noul derives its answer, confidence and probabilities from one value', () => {
  expect(normaliseAnswer(flag, { type: 'noul', noul: 0.8 })).toEqual({ answer: 'yes', probability: 0.8, confidence: 0.8, probabilities: { yes: 0.8, no: expect.closeTo(0.2, 10) as number } });
  const no = normaliseAnswer(flag, { type: 'noul', noul: 0.25 });
  expect(no.answer).toBe('no');
  expect(no.confidence).toBe(0.75);
  expect(normaliseAnswer(flag, { type: 'noul', noul: 0.5 }).answer).toBe('yes');
  expect(() => normaliseAnswer(flag, { type: 'noul', noul: 1.5 })).toThrow('INVALID_MODEL_OUTPUT');
  expect(() => normaliseAnswer(flag, { type: 'noul' })).toThrow('INVALID_MODEL_OUTPUT');
});

const set = { team, flag, urgency };
const answers = () => ({
  team: { type: 'choice', choice: 'billing', confidence: 0.9, probabilities: { billing: 0.9, none: 0.1 } },
  flag: { type: 'noul', noul: 0.95 },
  urgency: { type: 'score', score: 0, confidence: 0.4, probabilities: { '0': 0.4 } },
});

test('normaliseAnswers requires exactly the configured question ids and fails whole on one bad answer', () => {
  expect(Object.keys(normaliseAnswers(set, answers()))).toEqual(['team', 'flag', 'urgency']);
  const missing = { team: answers().team, flag: answers().flag };
  expect(() => normaliseAnswers(set, missing)).toThrow('INVALID_MODEL_OUTPUT');
  expect(() => normaliseAnswers(set, { ...answers(), extra: { type: 'noul', noul: 0.5 } })).toThrow('INVALID_MODEL_OUTPUT');
  expect(() => normaliseAnswers(set, { ...answers(), flag: { type: 'noul', noul: 2 } })).toThrow('INVALID_MODEL_OUTPUT');
});

test('band edges fall exactly on act and review', () => {
  const thresholds = { act: 0.85, review: 0.6 };
  expect(bandOf(0.85, thresholds)).toBe('act');
  expect(bandOf(0.8499, thresholds)).toBe('review');
  expect(bandOf(0.6, thresholds)).toBe('review');
  expect(bandOf(0.5999, thresholds)).toBe('escalate');
});

const judged = (patch: Record<string, unknown> = {}) => evaluateJudgment(config(patch) as unknown as JudgmentConfig, {
  team: { type: 'choice', choice: 'billing', confidence: 0.88, probabilities: { billing: 0.91, none: 0.09 } },
  refund_requested: { type: 'noul', noul: 0.85 },
  urgency: { type: 'score', score: 0.4, confidence: 0.2, probabilities: { '0': 0.6, '1': 0.4 } },
}, 'typesafe/jev-1.13', 'gen-dec-1');

test('evaluate builds the flat output with per-question overrides and a non-gating question', () => {
  const { output, bands } = judged();
  expect(output).toMatchObject({
    team_answer: 'billing', team_probability: 0.91, team_confidence: 0.88, team_band: 'act',
    refund_requested_answer: 'yes', refund_requested_band: 'review',
    urgency_answer: '0', urgency_score: 0.4, urgency_band: 'escalate',
    band: 'review', model: 'typesafe/jev-1.13', requestId: 'gen-dec-1',
    probabilities: { team: { billing: 0.91, none: 0.09 }, urgency: { '0': 0.6, '1': 0.4 } },
  });
  expect(bands).toEqual([{ id: 'team', type: 'choice', band: 'act' }, { id: 'refund_requested', type: 'noul', band: 'review' }, { id: 'urgency', type: 'score', band: 'escalate' }]);
});

test('the overall band is the most cautious gating band and defaults to act when nothing gates', () => {
  const escalating = config();
  questions(escalating)['team'] = { ...defined(questions(escalating)['team']), gate: true, thresholds: { act: 0.99, review: 0.95 } };
  expect(judged({ questions: questions(escalating) }).output['band']).toBe('escalate');
  const none = config();
  for (const id of Object.keys(questions(none))) questions(none)[id] = { ...defined(questions(none)[id]), gate: false };
  expect(judged({ questions: questions(none) }).output['band']).toBe('act');
});

test('requestId is omitted when the provider gave none', () => {
  const { output } = evaluateJudgment(config() as unknown as JudgmentConfig, {
    team: { type: 'choice', choice: 'billing', confidence: 0.88, probabilities: { billing: 0.91 } },
    refund_requested: { type: 'noul', noul: 0.85 },
    urgency: { type: 'score', score: 0.4, confidence: 0.2, probabilities: { '0': 0.6 } },
  }, 'typesafe/jev-1.13');
  expect('requestId' in output).toBe(false);
});

const factDefinition = (cfg: Record<string, unknown>) => ({ nodes: [{ id: 'triage', kind: 'judgment' as const, config: cfg, next: null }, { id: 'again', kind: 'judgment' as const, config: cfg, next: null }, { id: 'other', kind: 'agent' as const, config: {}, next: null }] });
const completed = (nodeId: string, kind = 'judgment') => ({ nodeId, kind, state: 'completed' as const, at: 'now', detail: 'x' });

test('judgment facts list one line per question in config order then an overall line', () => {
  const { output } = judged();
  const [fact] = judgmentFacts(factDefinition(config()), { history: [completed('triage')], outputs: { triage: output } });
  expect(fact?.name).toBe('judgment:triage');
  expect(fact?.value.split('\n')).toEqual([
    'team: billing · probability 0.91 · confidence 0.88 · band act',
    'refund_requested: yes · probability 0.85 · confidence 0.85 · band review',
    'urgency: 0 · probability 0.60 · confidence 0.20 · band escalate · not gating',
    'overall review · typesafe/jev-1.13',
  ]);
});

test('judgment facts keep the two most recent completed judgments newest first and ignore other steps', () => {
  const { output } = judged();
  const facts = judgmentFacts(factDefinition(config()), { history: [completed('triage'), completed('again'), completed('triage'), completed('other', 'agent')], outputs: { triage: output, again: output, other: {} } });
  expect(facts.map((fact) => fact.name)).toEqual(['judgment:triage', 'judgment:again']);
});

test('judgment facts skip steps without output and never exceed the fact limit', () => {
  expect(judgmentFacts(factDefinition(config()), { history: [completed('triage')], outputs: {} })).toEqual([]);
  const many = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`question_${String(index)}`, { type: 'noul', instructions: 'x'.repeat(10) }]));
  const output: Record<string, unknown> = { band: 'act', model: 'm/x' };
  for (const id of Object.keys(many)) Object.assign(output, { [`${id}_answer`]: 'y'.repeat(2000), [`${id}_probability`]: 1, [`${id}_confidence`]: 1, [`${id}_band`]: 'act' });
  const [fact] = judgmentFacts(factDefinition(config({ questions: many })), { history: [completed('triage')], outputs: { triage: output } });
  expect(fact?.value.length).toBe(4000);
});
