import { expect, test } from 'vitest';
import { compileGraph, validateGraph, type CapabilityPin, type GraphDraft, type GraphEdge, type GraphNode } from './graph.js';
import { POLICY, pinFor, shape } from './worker-harness.test-support.js';

const MERGE = { risk: 'R3' as const, capability: 'merge', inputSchema: shape({ owner: { type: 'string' }, note: { type: 'string' } }), outputSchema: shape({ result: { type: 'string' } }) };
const pin = (targetFields?: string[]): CapabilityPin => ({ ...pinFor('act', MERGE), ...(targetFields ? { targetFields } : {}) });
const JUDGMENT_POLICY = { ...POLICY, toolRounds: 0, effects: 0 };

const node = (id: string, kind: string, config: Record<string, unknown>, instructions = ''): GraphNode => ({ id, kind, title: id, detail: '', x: 0, y: 0, instructions, config });
const judgment = (patch: Record<string, unknown> = {}): GraphNode => node('triage', 'judgment', {
  provider: 'openrouter', openRouterOptIn: true, model: 'typesafe/jev-1.13',
  questions: {
    team: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'Charges', none: 'Other' } },
    refund: { type: 'noul', instructions: 'Wants a refund?' },
  },
  state: { ticket: '$input.body', history: '$node.recall.memory' },
  thresholds: { act: 0.85, review: 0.6 },
  policy: JUDGMENT_POLICY,
  ...patch,
});
const condition = (field: string, equals: string): GraphNode => node('cond', 'condition', { source: 'triage', field, equals });
const mcp = (args: Record<string, unknown>): GraphNode => { const p = pin(); return node('act', 'mcp', { installationId: p.installationId, capability: 'merge', manifestDigest: p.manifestDigest, grantId: p.grantId, target: 'repo', arguments: args, policy: POLICY }); };
const edge = (from: string, to: string, branch?: 'true' | 'false'): GraphEdge => ({ id: `${from}-${to}`, from, to, ...(branch ? { branch } : {}) });

const draft = (middle: GraphNode, args: Record<string, unknown> = { owner: '$input.owner', note: 'ok' }): GraphDraft => ({ kind: 'graph-v1', nodes: [
  node('start', 'trigger', { mode: 'manual', inputSchema: shape({ body: { type: 'string' }, owner: { type: 'string' } }) }),
  node('recall', 'memory', { limit: 3, maxChars: 1500, policy: POLICY }),
  middle,
  condition('band', 'act'),
  node('gate', 'approval', { timeoutMs: 1000 }),
  mcp(args),
  node('done', 'end', {}),
  node('human', 'end', { outcome: 'needs-human' }),
], edges: [edge('start', 'recall'), edge('recall', middle.id), edge(middle.id, 'cond'), edge('cond', 'gate', 'true'), edge('cond', 'human', 'false'), edge('gate', 'act'), edge('act', 'done')] });

const codes = (graph: GraphDraft, pinned: CapabilityPin[] = [pin()]): string[] => validateGraph(graph, pinned).map((item) => item.code);
const withCondition = (field: string, equals: string, middle = judgment()): string[] => { const graph = draft(middle); graph.nodes[3] = condition(field, equals); return codes(graph); };

test('a well-formed Judgment validates and compiles with its config unchanged', async () => {
  const graph = draft(judgment());
  expect(codes(graph)).toEqual([]);
  const compiled = await compileGraph('11111111-1111-4111-8111-111111111111', 1, graph, [pin()]);
  expect(compiled.nodes[2]).toMatchObject({ id: 'triage', kind: 'judgment', config: judgment().config, next: 'cond' });
  expect(compiled.nodes[2]).not.toHaveProperty('instructions');
});

test('invalid Judgment config reports INVALID_JUDGMENT on its config path', () => {
  const issues = validateGraph(draft(judgment({ model: '~typesafe/jev-latest' })), [pin()]);
  expect(issues).toContainEqual(expect.objectContaining({ path: '/nodes/2/config', code: 'INVALID_JUDGMENT' }));
});

test('state mappings must come from a strictly dominating source', () => {
  expect(codes(draft(judgment({ state: { ticket: '$input.body', again: '$node.cond.band' } })))).toContain('INVALID_MAPPING');
  expect(codes(draft(judgment({ state: { ticket: '$node.triage.band' } })))).toContain('INVALID_MAPPING');
  expect(codes(draft(judgment({ state: { ticket: '$node.missing.value' } })))).toContain('INVALID_MAPPING');
});

test('state mapping issues point at the state key', () => {
  const issues = validateGraph(draft(judgment({ state: { ticket: '$input.nothing' } })), [pin()]);
  expect(issues).toContainEqual(expect.objectContaining({ path: '/nodes/triage/config/state/ticket', code: 'INVALID_MAPPING' }));
});

test('memory sources only expose the memory field and other sources need an existing field', () => {
  expect(codes(draft(judgment({ state: { ticket: '$input.body', history: '$node.recall.items' } })))).toContain('INVALID_MAPPING');
  expect(codes(draft(judgment({ state: { ticket: '$input.body', history: '$node.recall.memory' } })))).toEqual([]);
});

test('a later Judgment can read an earlier Judgment output', () => {
  const graph = draft(judgment());
  const second = judgment({ state: { prior: '$node.triage.team_answer' } });
  graph.nodes.splice(3, 0, { ...second, id: 'second' });
  graph.edges = [edge('start', 'recall'), edge('recall', 'triage'), edge('triage', 'second'), edge('second', 'cond'), edge('cond', 'gate', 'true'), edge('cond', 'human', 'false'), edge('gate', 'act'), edge('act', 'done')];
  expect(codes(graph)).toEqual([]);
});

test('Conditions can branch on any answer, band and the overall band', () => {
  expect(withCondition('band', 'act')).toEqual([]);
  expect(withCondition('team_band', 'review')).toEqual([]);
  expect(withCondition('team_answer', 'billing')).toEqual([]);
  expect(withCondition('refund_answer', 'yes')).toEqual([]);
});

test('a Condition on a removed question or a wrong type fails with INVALID_MAPPING', () => {
  const removed = judgment({ questions: { refund: { type: 'noul', instructions: 'Wants a refund?' } } });
  expect(withCondition('team_answer', 'billing', removed)).toContain('INVALID_MAPPING');
  const graph = draft(judgment()); graph.nodes[3] = node('cond', 'condition', { source: 'triage', field: 'team_probability', equals: 'x' });
  expect(codes(graph)).toContain('INVALID_MAPPING');
});

test('effect targets mapped from a Judgment fail with TARGET_FROM_MODEL', () => {
  const graph = draft(judgment(), { owner: '$node.triage.team_answer', note: 'ok' });
  expect(codes(graph, [pin(['owner'])])).toContain('TARGET_FROM_MODEL');
  expect(codes(graph, [pin()])).not.toContain('TARGET_FROM_MODEL');
});

test('a tool edge from a Judgment is invalid', () => {
  const graph = draft(judgment());
  graph.nodes.push({ ...mcp({}), id: 'tooled' });
  graph.edges.push({ id: 'tool', from: 'triage', to: 'tooled', role: 'tool' });
  expect(codes(graph, [pin(), { ...pin(), nodeId: 'tooled' }])).toContain('INVALID_TOOL_EDGE');
});

test('compiling an existing fixture graph keeps its digest', async () => {
  const schema = shape({ result: { type: 'string' } });
  const fixture: GraphDraft = { kind: 'graph-v1', nodes: [
    node('start', 'trigger', { mode: 'manual', inputSchema: schema }),
    node('agent', 'agent', { provider: 'azure-openai', model: 'gpt-4.1', promptVersion: '1', responseSchema: schema, policy: POLICY, allowedCapabilities: [] }, 'Classify.'),
    node('end', 'end', {}),
  ], edges: [edge('start', 'agent'), edge('agent', 'end')] };
  const compiled = await compileGraph('11111111-1111-4111-8111-111111111111', 2, fixture, []);
  expect(compiled.digest).toBe(FIXTURE_DIGEST);
});

const FIXTURE_DIGEST = '48a9b1b7e4fe7265cc5100813f62754ecc6fffe8ea6b42292655c59c24c0a9ea';
