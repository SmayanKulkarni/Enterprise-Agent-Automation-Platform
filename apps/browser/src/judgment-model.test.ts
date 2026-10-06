import { describe, expect, test } from 'vitest';
import { addQuestion, answerValues, changeQuestionType, defaultJudgmentConfig, memoryLimitWarning, nextQuestionId, pinnedModels, questionIdError, questionReferences, removeQuestion, renameQuestion, setCriteriaKey, QUESTION_LIMIT } from './judgment-model.js';
import { judgmentConfigValid } from '../../../packages/workflow/src/judgment.js';
import { stateOptions, type WorkflowEdge, type WorkflowNode } from './workflow-model.js';

const node = (id: string, kind: WorkflowNode['kind'], config: Record<string, unknown> = {}, title = id): WorkflowNode => ({ id, kind, title, detail: '', x: 0, y: 0, instructions: '', config });
const trigger = node('trigger', 'trigger', { mode: 'manual', inputSchema: { type: 'object', properties: { count: { type: 'number' }, body: { type: 'string' }, subject: { type: 'string' } }, required: [], additionalProperties: false } });
const edge = (from: string, to: string, branch?: 'true' | 'false'): WorkflowEdge => ({ id: `${from}-${to}`, from, to, ...(branch ? { branch } : {}) });

describe('default Judgment config', () => {
  test('uses the pinned Jev model, one choice question, the first string trigger field and valid bands and policy', () => {
    const config = defaultJudgmentConfig(trigger);
    expect(config).toMatchObject({
      provider: 'openrouter', openRouterOptIn: true, model: 'typesafe/jev-1.13',
      state: { request: '$input.body' }, thresholds: { act: 0.85, review: 0.6 },
      policy: { milliseconds: 15000, attempts: 2, tokens: 8000, cost: 0.01, toolRounds: 0, effects: 0 },
    });
    expect(config['questions']).toEqual({ intent: { type: 'choice', instructions: 'Which option best describes `request`? Pick none when nothing fits.', criteria: { yes_action: 'The request should go ahead', none: 'Nothing fits or the request is unclear' } } });
    expect(judgmentConfigValid({ instructions: '', config })).toBe(true);
  });

  test('falls back to empty state without a string field or a trigger', () => {
    const numeric = node('trigger', 'trigger', { inputSchema: { type: 'object', properties: { count: { type: 'number' } }, required: [], additionalProperties: false } });
    expect(defaultJudgmentConfig(numeric)['state']).toEqual({});
    expect(defaultJudgmentConfig(undefined)['state']).toEqual({});
  });
});

describe('question ids', () => {
  test('are validated against the id rules and uniqueness', () => {
    expect(questionIdError('team', ['team', 'urgency'], 'team')).toBeUndefined();
    expect(questionIdError('Team', [])).toMatch(/lowercase/u);
    expect(questionIdError('1team', [])).toMatch(/lowercase/u);
    expect(questionIdError('a'.repeat(33), [])).toMatch(/32/u);
    expect(questionIdError('urgency', ['team', 'urgency'], 'team')).toMatch(/already/u);
    expect(questionIdError('', [])).toMatch(/Enter/u);
  });

  test('the next free id does not collide', () => {
    expect(nextQuestionId({})).toBe('question_1');
    expect(nextQuestionId({ question_1: {}, question_2: {} })).toBe('question_3');
  });
});

describe('editing questions', () => {
  const base = (): Record<string, unknown> => defaultJudgmentConfig(trigger);
  test('add appends a valid choice question and stops at 16', () => {
    let config = base();
    for (let index = 1; index < QUESTION_LIMIT; index += 1) config = addQuestion(config);
    expect(Object.keys(config['questions'] as object)).toHaveLength(16);
    expect(judgmentConfigValid({ instructions: '', config })).toBe(true);
    expect(addQuestion(config)).toBe(config);
  });

  test('remove keeps at least one question', () => {
    const two = addQuestion(base());
    expect(Object.keys(removeQuestion(two, 'question_1')['questions'] as object)).toEqual(['intent']);
    expect(removeQuestion(base(), 'intent')).toEqual(base());
  });

  test('rename keeps order and content and refuses invalid or taken ids', () => {
    const two = addQuestion(base());
    const renamed = renameQuestion(two, 'intent', 'team');
    expect(Object.keys(renamed['questions'] as object)).toEqual(['team', 'question_1']);
    expect((renamed['questions'] as Record<string, unknown>)['team']).toEqual((two['questions'] as Record<string, unknown>)['intent']);
    expect(renameQuestion(two, 'intent', 'question_1')).toBe(two);
    expect(renameQuestion(two, 'intent', 'Bad')).toBe(two);
  });

  test('changing the type resets criteria to a valid shape and keeps instructions and bands', () => {
    const question = { type: 'choice' as const, instructions: 'Keep me', criteria: { a: 'A', b: 'B' }, thresholds: { act: 0.9, review: 0.7 }, gate: false };
    expect(changeQuestionType(question, 'score')).toEqual({ type: 'score', instructions: 'Keep me', criteria: ['Low', 'High'], thresholds: { act: 0.9, review: 0.7 }, gate: false });
    expect(changeQuestionType(question, 'noul')).toEqual({ type: 'noul', instructions: 'Keep me', thresholds: { act: 0.9, review: 0.7 }, gate: false });
    expect(changeQuestionType(question, 'choice')).toBe(question);
  });

  test('renaming a choice key keeps the criteria order', () => {
    expect(Object.keys(setCriteriaKey({ b: 'B', a: 'A', c: 'C' }, 'a', 'z'))).toEqual(['b', 'z', 'c']);
    expect(setCriteriaKey({ a: 'A', b: 'B' }, 'a', 'b')).toEqual({ a: 'A', b: 'B' });
  });
});

describe('references to a question', () => {
  const judgment = node('triage', 'judgment', defaultJudgmentConfig(trigger), 'Triage');
  const condition = node('cond', 'condition', { source: 'triage', field: 'intent_answer', equals: 'yes_action' }, 'Is it go');
  const overall = node('overall', 'condition', { source: 'triage', field: 'band', equals: 'act' }, 'Confident');
  const second = node('second', 'judgment', { ...defaultJudgmentConfig(trigger), state: { prior: '$node.triage.intent_band' } }, 'Second');
  const mcp = node('act', 'mcp', { arguments: { label: '$node.triage.intent_answer', other: '$input.body' } }, 'Label it');
  const nodes = [trigger, judgment, condition, overall, second, mcp];

  test('lists Conditions, Judgment state and MCP arguments that read the question fields', () => {
    expect(questionReferences(nodes, 'triage', 'intent')).toEqual(['Is it go', 'Second', 'Label it']);
  });

  test('ignores the overall band and other questions', () => {
    expect(questionReferences(nodes, 'triage', 'other')).toEqual([]);
  });
});

describe('Condition values for a Judgment source', () => {
  const config = { ...defaultJudgmentConfig(trigger), questions: { team: { type: 'choice', instructions: 'x', criteria: { billing: 'a', none: 'b' } }, flag: { type: 'noul', instructions: 'x' }, level: { type: 'score', instructions: 'x', criteria: ['a', 'b', 'c'] } } };
  test('answers come from the question and bands from the three bands', () => {
    expect(answerValues(config, 'team_answer')).toEqual(['billing', 'none']);
    expect(answerValues(config, 'flag_answer')).toEqual(['yes', 'no']);
    expect(answerValues(config, 'level_answer')).toEqual(['0', '1', '2']);
    expect(answerValues(config, 'team_band')).toEqual(['act', 'review', 'escalate']);
    expect(answerValues(config, 'band')).toEqual(['act', 'review', 'escalate']);
  });

  test('other fields offer nothing', () => {
    expect(answerValues(config, 'team_probability')).toBeUndefined();
    expect(answerValues(config, 'model')).toBeUndefined();
    expect(answerValues(config, 'ghost_answer')).toBeUndefined();
  });
});

describe('state sources', () => {
  const memory = node('recall', 'memory', { limit: 5, maxChars: 1000 }, 'Recall');
  const agent = node('brain', 'agent', { responseSchema: { type: 'object', properties: { verdict: { type: 'string' } }, required: [], additionalProperties: false } }, 'Brain');
  const judgment = node('triage', 'judgment', defaultJudgmentConfig(trigger), 'Triage');
  const nodes = [trigger, memory, agent, judgment, node('end', 'end')];
  const edges = [edge('trigger', 'recall'), edge('recall', 'brain'), edge('brain', 'triage'), edge('triage', 'end')];

  test('offer trigger fields of any type, dominating step fields and the memory output', () => {
    const options = stateOptions(nodes, edges, 'triage', undefined);
    expect(options.map(([value]) => value)).toEqual(['$input.count', '$input.body', '$input.subject', '$node.recall.memory', '$node.brain.verdict']);
  });

  test('exclude the Judgment itself and later steps', () => {
    expect(stateOptions(nodes, edges, 'recall', undefined).map(([value]) => value)).toEqual(['$input.count', '$input.body', '$input.subject']);
  });

  test('warn when a mapped Memory step returns more than 3 items', () => {
    expect(memoryLimitWarning({ history: '$node.recall.memory' }, nodes)).toMatch(/3 items or fewer/u);
    expect(memoryLimitWarning({ history: '$input.body' }, nodes)).toBeUndefined();
    expect(memoryLimitWarning({ history: '$node.recall.memory' }, [trigger, { ...memory, config: { limit: 3 } }])).toBeUndefined();
  });
});

describe('pinned decision models', () => {
  test('drops moving aliases and keeps exact versions', () => {
    const models = [{ id: '~typesafe/jev-latest', structuredOutput: false }, { id: 'typesafe/jev-1.13', structuredOutput: false }];
    expect(pinnedModels(models).map((model) => model.id)).toEqual(['typesafe/jev-1.13']);
  });
});
