import { expect, test } from 'vitest';
import { disclosedFacts, FACT_LIMIT, validateGraph, type GraphDraft, type NodePolicy } from './graph.js';
import type { CapabilityPin } from './graph.js';

const policy: NodePolicy = { milliseconds: 5000, attempts: 1, tokens: 1000, cost: 1, toolRounds: 0, effects: 1 };
const shape = (properties: Record<string, { type: 'string' | 'number' }>) => ({ type: 'object' as const, properties, required: Object.keys(properties), additionalProperties: false as const });
const pin: CapabilityPin = { nodeId: 'act', installationId: 'a1111111-1111-4111-8111-111111111111', capability: 'write', manifestDigest: 'd', grantId: 'g1111111-1111-4111-8111-111111111111', risk: 'R2', inputSchema: shape({ title: { type: 'string' }, count: { type: 'number' } }), outputSchema: shape({ result: { type: 'string' } }) };

const draft = (approval: Record<string, unknown>): GraphDraft => {
  const node = (id: string, kind: string, config: Record<string, unknown>) => ({ id, kind, title: id, detail: '', x: 1, y: 1, instructions: kind === 'agent' ? 'Review.' : '', config });
  return { kind: 'graph-v1', nodes: [
    node('start', 'trigger', { mode: 'manual', inputSchema: shape({ title: { type: 'string' } }) }),
    node('brain', 'agent', { provider: 'azure-openai', model: 'gpt-4.1', promptVersion: '1', responseSchema: shape({ summary: { type: 'string' } }), policy, allowedCapabilities: ['write'] }),
    node('gate', 'approval', approval),
    node('act', 'mcp', { installationId: pin.installationId, capability: 'write', manifestDigest: 'd', grantId: pin.grantId, target: 'repo', arguments: { title: '$node.brain.summary', count: 3 }, policy }),
    node('end', 'end', {}),
  ], edges: [{ id: 'a', from: 'start', to: 'brain' }, { id: 'b', from: 'brain', to: 'gate' }, { id: 'c', from: 'gate', to: 'act' }, { id: 'd', from: 'act', to: 'end' }] };
};
const codes = (approval: Record<string, unknown>): string[] => validateGraph(draft(approval), [pin]).map((item) => item.code);

test('approval without disclose stays valid and shows nothing', () => {
  expect(codes({ timeoutMs: 1000 })).toEqual([]);
});

test('approval may disclose arguments of the effect it guards', () => {
  expect(codes({ timeoutMs: 1000, disclose: ['title', 'count'] })).toEqual([]);
});

test.each([
  ['an unknown argument', ['missing']],
  ['a duplicate', ['title', 'title']],
  ['more than six names', ['a', 'b', 'c', 'd', 'e', 'f', 'g']],
  ['a non-string name', [1]],
])('approval rejects disclose with %s', (_label, disclose) => {
  expect(codes({ timeoutMs: 1000, disclose })).toContain('INVALID_DISCLOSURE');
});

test('approval rejects a disclose that is not a list', () => {
  expect(codes({ timeoutMs: 1000, disclose: 'title' })).toContain('INVALID_DISCLOSURE');
});

test('disclosedFacts returns only named scalar values as bounded text', () => {
  const args = { title: 'x'.repeat(FACT_LIMIT + 10), count: 3, flag: true, nested: { a: 1 }, secret: 'hidden' };
  const facts = disclosedFacts(args, ['title', 'count', 'flag', 'nested', 'absent']);
  expect(facts).toEqual([{ name: 'title', value: 'x'.repeat(FACT_LIMIT) }, { name: 'count', value: '3' }, { name: 'flag', value: 'true' }]);
  expect(JSON.stringify(facts)).not.toContain('hidden');
});

test('disclosedFacts is empty without a disclose list', () => {
  expect(disclosedFacts({ title: 'x' }, undefined)).toEqual([]);
});
