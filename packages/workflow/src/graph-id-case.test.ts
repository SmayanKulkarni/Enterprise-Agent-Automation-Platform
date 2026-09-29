import { expect, test } from 'vitest';
import { validateGraph, type CapabilityPin, type GraphDraft, type NodePolicy } from './graph.js';

const policy: NodePolicy = { milliseconds: 5000, attempts: 1, tokens: 0, cost: 0, toolRounds: 0, effects: 1 };
const schema = { type: 'object' as const, properties: { label: { type: 'string' as const } }, required: ['label'], additionalProperties: false as const };
const empty = { type: 'object' as const, properties: {}, required: [], additionalProperties: false as const };
const installationId = '44444444-4444-4444-8444-44444444abcd';
const grantId = '66666666-6666-4666-8666-66666666abcd';
const digest = 'd'.repeat(64);
const graph: GraphDraft = { kind: 'graph-v1', nodes: [
  { id: 'start', kind: 'trigger', title: 'Start', detail: '', x: 10, y: 10, instructions: '', config: { mode: 'manual', inputSchema: empty } },
  { id: 'mcp', kind: 'mcp', title: 'Tool', detail: '', x: 20, y: 10, instructions: '', config: { installationId, capability: 'draw', manifestDigest: digest, grantId, target: '', arguments: { label: 'x' }, policy } },
  { id: 'end', kind: 'end', title: 'End', detail: '', x: 30, y: 10, instructions: '', config: {} },
], edges: [{ id: 'a', from: 'start', to: 'mcp' }, { id: 'b', from: 'mcp', to: 'end' }] };
const pin = (grant: string): CapabilityPin => ({ nodeId: 'mcp', installationId, capability: 'draw', manifestDigest: digest, grantId: grant, risk: 'R1', inputSchema: schema, outputSchema: empty });

test('a stored grant id matches the node binding regardless of letter case', () => {
  expect(validateGraph(graph, [pin(grantId)]).map((issue) => issue.code)).not.toContain('UNGRANTED_CAPABILITY');
  expect(validateGraph(graph, [pin(grantId.toUpperCase())]).map((issue) => issue.code)).not.toContain('UNGRANTED_CAPABILITY');
});
