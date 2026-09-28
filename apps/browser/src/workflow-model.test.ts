import { describe, expect, test } from 'vitest';
import { conditionFields, conditionSources, connect, disconnect, expiryInstant, initialEdges, initialNodes, issueNode, localDateTime, mappingFields, memoryProposalsEnabled, parseTriggerInput, setMemoryProposals, setSchemaField, starterEdges, starterNodes, updateIntegerConfig } from './workflow-model.js';

describe('workflow graph', () => {
  test('only creates valid, non-duplicate connections', () => {
    expect(connect(initialNodes, initialEdges, 'trigger', 'plan')).toHaveLength(initialEdges.length + 1);
    expect(connect(initialNodes, initialEdges, 'trigger', 'triage')).toEqual(initialEdges);
    expect(connect(initialNodes, initialEdges, 'trigger', 'missing')).toEqual(initialEdges);
  });

  test('offers only preceding typed condition sources and prevents duplicate branches', () => {
    const nodes = [...starterNodes, { id: 'condition', kind: 'condition' as const, title: 'Condition', detail: '', x: 0, y: 0, instructions: '', config: { source: 'agent', field: 'result', equals: 'ready' } }];
    const edges = [...starterEdges.slice(0, 1), { id: 'agent-condition', from: 'agent', to: 'condition' }];
    expect(conditionSources(nodes, edges, 'condition').map((node) => node.id)).toEqual(['trigger', 'agent']);
    expect(conditionFields(nodes[1]!)).toEqual([['result', 'string']]);
    const branched = connect(nodes, edges, 'condition', 'trigger', 'true');
    expect(connect(nodes, branched, 'condition', 'agent', 'true')).toEqual(branched);
  });

  test('removes a connection by id', () => {
    expect(disconnect(initialEdges, 'trigger-triage')).not.toContainEqual(expect.objectContaining({ id: 'trigger-triage' }));
  });

  test('updates only valid memory bounds', () => {
    const config = { limit: 3, maxChars: 2000, policy: { tokens: 0 } };
    expect(updateIntegerConfig(config, 'limit', '4', 1, 20).config).toEqual({ ...config, limit: 4 });
    for (const value of ['', '1.5', '21', 'Infinity']) expect(updateIntegerConfig(config, 'limit', value, 1, 20)).toEqual({ error: 'Enter a whole number from 1 to 20.' });
  });

  test('adds and removes only the optional proposal schema field', () => {
    const config = { provider: 'azure-openai', responseSchema: { type: 'object', properties: { result: { type: 'string' } }, required: ['result', 'memoryProposals'], additionalProperties: false } };
    const enabled = setMemoryProposals(config, true);
    expect(enabled).toMatchObject({ provider: 'azure-openai', responseSchema: { properties: { result: { type: 'string' }, memoryProposals: { type: 'array' } }, required: ['result'] } });
    expect(memoryProposalsEnabled(enabled)).toBe(true);
    expect(setMemoryProposals(enabled, false)).toEqual({ ...config, responseSchema: { ...config.responseSchema, required: ['result'], properties: { result: { type: 'string' } } } });
  });

  test('converts a valid local expiry and rejects extensions or invalid values', () => {
    const current = '2026-10-01T12:00:00.000Z';
    expect(localDateTime(current)).toMatch(/^2026-10-01T/);
    expect(expiryInstant('2026-09-30T12:00', current, Date.parse('2026-09-01T00:00:00.000Z')).iso).toBe(new Date(2026, 8, 30, 12).toISOString());
    expect(expiryInstant('', current).error).toBe('Enter an expiry date and time.');
    expect(expiryInstant('2026-02-30T12:00', current).error).toBe('Enter a valid expiry date and time.');
    expect(expiryInstant('2026-10-02T12:00', current).error).toBe('Expiry can only be shortened.');
  });

  test('edits a trigger contract and parses typed manual input', () => {
    const schema = setSchemaField({ type: 'object', properties: {}, required: [], additionalProperties: false }, 'priority', 'number', true);
    expect(schema).toEqual({ type: 'object', properties: { priority: { type: 'number' } }, required: ['priority'], additionalProperties: false });
    expect(parseTriggerInput(schema, { priority: '3' })).toEqual({ input: { priority: 3 } });
    expect(parseTriggerInput(schema, { priority: '' })).toEqual({ errors: { priority: 'Required.' } });
  });

  test('offers only preceding fields with the requested mapping type', () => {
    const nodes = [...starterNodes, { id: 'mcp', kind: 'mcp' as const, title: 'Action', detail: '', x: 0, y: 0, instructions: '', config: {} }];
    const edges = [...starterEdges, { id: 'agent-mcp', from: 'agent', to: 'mcp' }];
    expect(mappingFields(nodes, edges, 'mcp', 'string')).toEqual([['$node.agent.result', 'Classify request · result']]);
    expect(mappingFields(nodes, edges, 'mcp', 'number')).toEqual([]);
  });

  test('resolves a check issue path to its node by id or index', () => {
    expect(issueNode(starterNodes, '/nodes/agent/config/model')?.id).toBe('agent');
    expect(issueNode(starterNodes, '/nodes/1/config/model')?.id).toBe('agent');
    expect(issueNode(starterNodes, '/nodes/missing')).toBeUndefined();
    expect(issueNode(starterNodes, '/edges/0')).toBeUndefined();
  });
});
