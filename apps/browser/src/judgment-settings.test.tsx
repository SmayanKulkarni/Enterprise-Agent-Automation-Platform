import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { Inspector } from './inspector.js';
import { addQuestion, defaultJudgmentConfig } from './judgment-model.js';
import type { WorkflowEdge, WorkflowNode } from './workflow-model.js';

const node = (id: string, kind: WorkflowNode['kind'], config: Record<string, unknown> = {}, title = id): WorkflowNode => ({ id, kind, title, detail: '', x: 0, y: 0, instructions: '', config });
const trigger = node('trigger', 'trigger', { mode: 'manual', inputSchema: { type: 'object', properties: { body: { type: 'string' } }, required: ['body'], additionalProperties: false } });
const edge = (from: string, to: string, branch?: 'true' | 'false'): WorkflowEdge => ({ id: `${from}-${to}`, from, to, ...(branch ? { branch } : {}) });
const decisionModels = [{ id: 'typesafe/jev-1.13', structuredOutput: false, name: 'Jev 1.13', contextLength: 32000 }];

const render = (selected: WorkflowNode, nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[] = [], extra: { connection?: string; models?: typeof decisionModels } = {}) => renderToStaticMarkup(<Inspector node={selected} nodes={nodes} edges={edges} tab="instructions" setTab={() => undefined} updateNode={() => undefined} live model="" setModel={() => undefined} maxSteps={1} setMaxSteps={() => undefined} openRouterModels={[]} openRouterConnectionState={extra.connection ?? 'ready'} decisionModels={extra.models ?? decisionModels} />);
const judgmentNode = (config = defaultJudgmentConfig(trigger)) => node('triage', 'judgment', config, 'Judge request');
const settings = (config = defaultJudgmentConfig(trigger), nodes: readonly WorkflowNode[] = [trigger]) => { const judgment = judgmentNode(config); return render(judgment, [...nodes, judgment], [edge('trigger', 'triage')]); };

describe('Judgment settings form', () => {
  test('shows the model picker on the decision catalog, the state editor, bands, a question card and a locked policy', () => {
    const html = settings();
    for (const text of ['Decision model', 'typesafe/jev-1.13', 'All questions read the same state', 'State key', 'Default confidence bands', 'Questions (1 of 16)', 'Question intent', 'Add question', 'Fixed at 0']) expect(html).toContain(text);
    expect(html).not.toContain('System instructions');
    expect(html.match(/Fixed at 0/gu)).toHaveLength(2);
  });

  test('shows the real value of a locked policy field from an imported draft', () => {
    const config = defaultJudgmentConfig(trigger);
    const imported = { ...config, policy: { ...(config['policy'] as Record<string, number>), toolRounds: 5 } };
    const html = render(judgmentNode(imported), [trigger, judgmentNode(imported)]);
    expect(html).toContain('value="5"');
  });

  test('shows the connection notice only when OpenRouter is not ready', () => {
    const judgment = judgmentNode();
    expect(render(judgment, [trigger, judgment], [], { connection: 'not-connected' })).toContain("OpenRouter isn&#x27;t ready in this workspace (not-connected)");
    expect(settings()).not.toContain("isn&#x27;t ready");
  });

  test('offers trigger fields and Memory output as state sources and warns about a large Memory limit', () => {
    const memory = node('recall', 'memory', { limit: 5, maxChars: 1000 }, 'Recall');
    const config = { ...defaultJudgmentConfig(trigger), state: { history: '$node.recall.memory' } };
    const judgment = judgmentNode(config);
    const html = render(judgment, [trigger, memory, judgment], [edge('trigger', 'recall'), edge('recall', 'triage')]);
    expect(html).toContain('Recall · memory');
    expect(html).toContain('trigger · body');
    expect(html).toContain('Large memory context can distract the decision model; 3 items or fewer is recommended.');
    const calm = render(judgment, [trigger, { ...memory, config: { limit: 3, maxChars: 1000 } }, judgment], [edge('trigger', 'recall'), edge('recall', 'triage')]);
    expect(calm).not.toContain('Large memory context');
  });

  test('add is enabled below 16 questions and disabled at 16', () => {
    expect(settings()).toMatch(/<button[^>]*class="dashed-button"[^>]*>Add question<\/button>/u);
    let config = defaultJudgmentConfig(trigger);
    for (let index = 1; index < 16; index += 1) config = addQuestion(config);
    const html = settings(config);
    expect(html).toContain('Questions (16 of 16)');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Add question<\/button>/u);
    expect(html.match(/Remove question<\/button>/gu)).toHaveLength(16);
  });

  test('remove is disabled for the only question and enabled with two', () => {
    expect(settings()).toMatch(/<button[^>]*disabled=""[^>]*>Remove question<\/button>/u);
    const two = settings(addQuestion(defaultJudgmentConfig(trigger)));
    expect(two).not.toMatch(/disabled=""[^>]*>Remove question<\/button>/u);
  });

  test('a question card shows the choice criteria editor with its limits, the gate toggle and collapsed own bands', () => {
    const html = settings();
    for (const text of ['Option key', 'Add option', 'Add a none option', 'Gates the step', 'Own confidence bands (using the default)', 'Ask about facts in the state']) expect(html).toContain(text);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Remove option<\/button>/u);
    expect(html).toContain('Output fields start with intent_');
  });

  test('score and yes/no questions show their own criteria editors', () => {
    const config = { ...defaultJudgmentConfig(trigger), questions: { level: { type: 'score', instructions: 'x', criteria: ['Low', 'High'] }, flag: { type: 'noul', instructions: 'x', gate: false, thresholds: { act: 0.9, review: 0.7 } } } };
    const html = settings(config);
    for (const text of ['Level 0', 'Level 1', 'Add level', 'Yes means (optional)', 'Own confidence bands<']) expect(html).toContain(text);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Remove level<\/button>/u);
    expect(html).toContain('Use the default bands');
  });

  test('the id field shows the output prefix for the question', () => {
    const config = { ...defaultJudgmentConfig(trigger), questions: { team: { type: 'noul', instructions: 'x' } } };
    expect(settings(config)).toContain('Output fields start with team_ (for example team_answer).');
  });
});

describe('Condition editor after a Judgment', () => {
  const judgmentConfig = { ...defaultJudgmentConfig(trigger), questions: { team: { type: 'choice', instructions: 'x', criteria: { billing: 'a', none: 'b' } }, flag: { type: 'noul', instructions: 'x' } } };
  const judgment = node('triage', 'judgment', judgmentConfig, 'Triage');
  const condition = (field: string) => node('cond', 'condition', { source: 'triage', field, equals: '' }, 'Check');
  const view = (field: string) => { const check = condition(field); return render(check, [trigger, judgment, check], [edge('trigger', 'triage'), edge('triage', 'cond')]); };

  test('lists the Judgment output fields as options', () => {
    const html = view('team_answer');
    for (const field of ['team_answer', 'team_band', 'flag_answer', 'band']) expect(html).toContain(`>${field} (string)<`);
  });

  test('offers the answer values of the question for an answer field', () => {
    expect(view('team_answer')).toContain('<datalist id="cond-values"><option value="billing"></option><option value="none"></option></datalist>');
    expect(view('flag_answer')).toContain('<option value="yes"></option><option value="no"></option>');
  });

  test('offers act, review and escalate for band fields', () => {
    const bands = '<option value="act"></option><option value="review"></option><option value="escalate"></option>';
    expect(view('band')).toContain(bands);
    expect(view('team_band')).toContain(bands);
  });
});
