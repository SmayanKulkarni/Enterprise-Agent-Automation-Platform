import { expect, test } from 'vitest';
import { validateGraph, type CapabilityPin, type GraphDraft } from './graph.js';
import { POLICY, pinFor, shape } from './worker-harness.test-support.js';

const MERGE = { risk: 'R3' as const, capability: 'merge', inputSchema: shape({ owner: { type: 'string' }, pr: { type: 'number' }, title: { type: 'string' } }), outputSchema: shape({ result: { type: 'string' } }) };
const pin = (targetFields?: string[]): CapabilityPin => ({ ...pinFor('act', MERGE), ...(targetFields ? { targetFields } : {}) });

const draft = (args: Record<string, unknown>): GraphDraft => {
  const node = (id: string, kind: string, config: Record<string, unknown>) => ({ id, kind, title: id, detail: '', x: 0, y: 0, instructions: kind === 'agent' ? 'Review.' : '', config });
  const p = pin();
  return { kind: 'graph-v1', nodes: [
    node('start', 'trigger', { mode: 'manual', inputSchema: shape({ owner: { type: 'string' }, pr: { type: 'number' } }) }),
    node('brain', 'agent', { provider: 'azure-openai', model: 'gpt-4.1', promptVersion: '1', responseSchema: shape({ owner: { type: 'string' }, pr: { type: 'number' }, title: { type: 'string' } }), policy: POLICY, allowedCapabilities: ['merge'] }),
    node('gate', 'approval', { timeoutMs: 1000 }),
    node('act', 'mcp', { installationId: p.installationId, capability: 'merge', manifestDigest: p.manifestDigest, grantId: p.grantId, target: 'repo', arguments: args, policy: POLICY }),
    node('end', 'end', {}),
  ], edges: [{ id: 'a', from: 'start', to: 'brain' }, { id: 'b', from: 'brain', to: 'gate' }, { id: 'c', from: 'gate', to: 'act' }, { id: 'd', from: 'act', to: 'end' }] };
};
const codes = (args: Record<string, unknown>, targetFields?: string[]): string[] => validateGraph(draft(args), [pin(targetFields)]).map((issue) => issue.code);

test('identity fields of an effect may come from the trigger input', () => {
  expect(codes({ owner: '$input.owner', pr: '$input.pr', title: '$node.brain.title' }, ['owner', 'pr'])).toEqual([]);
});

test('identity fields of an effect may not come from model output', () => {
  expect(codes({ owner: '$node.brain.owner', pr: '$input.pr', title: '$node.brain.title' }, ['owner', 'pr'])).toEqual(['TARGET_FROM_MODEL']);
});

test('only the declared identity fields are restricted, and capabilities without any are unchanged', () => {
  expect(codes({ owner: '$node.brain.owner', pr: '$node.brain.pr', title: '$node.brain.title' }, ['owner']).filter((code) => code === 'TARGET_FROM_MODEL')).toHaveLength(1);
  expect(codes({ owner: '$node.brain.owner', pr: '$input.pr', title: '$node.brain.title' })).toEqual([]);
});
