import { expect, test } from 'vitest';
import { compileGraph, validateGraph, type GraphDraft, type NodePolicy } from './graph.js';

const policy: NodePolicy = { milliseconds: 5000, attempts: 1, tokens: 1000, cost: 1, toolRounds: 1, effects: 1 };
const schema = { type: 'object' as const, properties: { result: { type: 'string' as const } }, required: ['result'], additionalProperties: false as const };
const graph = (): GraphDraft => ({ kind: 'graph-v1', nodes: [
  { id: 'start', kind: 'trigger', title: 'Start', detail: '', x: 10, y: 10, instructions: '', config: { mode: 'manual', inputSchema: schema } },
  { id: 'agent', kind: 'agent', title: 'Agent', detail: '', x: 20, y: 10, instructions: 'Classify.', config: { provider: 'azure-openai', model: 'gpt-4.1', promptVersion: '1', responseSchema: schema, policy, allowedCapabilities: [] } },
  { id: 'end', kind: 'end', title: 'End', detail: '', x: 30, y: 10, instructions: '', config: {} },
], edges: [{ id: 'a', from: 'start', to: 'agent' }, { id: 'b', from: 'agent', to: 'end' }] });

test('graph compiler pins execution fields and excludes canvas metadata', async () => {
  const first = graph();
  expect(validateGraph(first)).toEqual([]);
  const compiled = await compileGraph('11111111-1111-4111-8111-111111111111', 2, first, []);
  first.nodes[1]!.title = 'Changed label'; first.nodes[1]!.x = 999;
  expect((await compileGraph(compiled.id, 2, first, [])).digest).toBe(compiled.digest);
  expect(compiled.nodes[1]).toMatchObject({ id: 'agent', next: 'end', instructions: 'Classify.' });
});

test('graph compiler rejects forks, orphans, cycles, unsupported nodes and unreachable paths', () => {
  const forked = graph(); forked.edges.push({ id: 'c', from: 'start', to: 'end' });
  expect(validateGraph(forked).map((issue) => issue.code)).toContain('INVALID_SUCCESSOR');
  const orphan = graph(); orphan.edges.pop();
  expect(validateGraph(orphan).map((issue) => issue.code)).toContain('MISSING_INPUT');
  const cyclic = graph(); cyclic.edges[1] = { id: 'b', from: 'agent', to: 'start' };
  expect(validateGraph(cyclic).map((issue) => issue.code)).toContain('CYCLE');
  const unsupported = graph(); unsupported.nodes[1]!.kind = 'http';
  expect(validateGraph(unsupported).map((issue) => issue.code)).toContain('UNSUPPORTED_KIND');
  const dangling = graph(); dangling.edges[1]!.to = 'missing';
  expect(validateGraph(dangling).map((issue) => issue.code)).toContain('DANGLING_EDGE');
  const unbounded = graph(); unbounded.nodes[1]!.config['policy'] = { ...policy, milliseconds: Number.MAX_SAFE_INTEGER };
  expect(validateGraph(unbounded).map((issue) => issue.code)).toContain('INVALID_AGENT');
  const branch = graph(); branch.edges[1]!.branch = 'true';
  expect(validateGraph(branch).map((issue) => issue.code)).toContain('INVALID_SUCCESSOR');
  const alias = graph(); alias.nodes[1]!.config['model'] = 'openai/gpt 4.1';
  expect(validateGraph(alias).map((issue) => issue.code)).toContain('INVALID_AGENT');
  const duplicateFallback = graph(); duplicateFallback.nodes[1]!.config['fallback'] = 'gpt-4.1';
  expect(validateGraph(duplicateFallback).map((issue) => issue.code)).toContain('INVALID_AGENT');
});

test('accepts optional memory proposals and rejects a required or non-array proposal field', () => {
  const enabled = graph();
  enabled.nodes[1]!.config['responseSchema'] = { ...schema, properties: { ...schema.properties, memoryProposals: { type: 'array' } } };
  expect(validateGraph(enabled)).toEqual([]);
  const invalid = graph();
  invalid.nodes[1]!.config['responseSchema'] = { ...schema, properties: { ...schema.properties, memoryProposals: { type: 'string' } }, required: ['result', 'memoryProposals'] };
  expect(validateGraph(invalid).map((issue) => issue.code)).toContain('INVALID_AGENT');
});
