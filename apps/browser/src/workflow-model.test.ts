import { describe, expect, test } from 'vitest';
import type { WorkflowEdge, WorkflowNode } from './workflow-model.js';
import { memoryProvenance, retrievalRank, createNode, freeSequence, attachTool, conditionFields, conditionSources, connect, connectionError, disconnect, expiryInstant, filterLibrary, initialEdges, initialNodes, issueNode, localDateTime, mappingFields, memoryProposalsEnabled, syncChainGrants, toolError, toolsOf, parseTriggerInput, schemaFieldNameError, setMemoryProposals, setSchemaField, starterEdges, starterNodes, updateIntegerConfig } from './workflow-model.js';

describe('workflow graph', () => {
  test('only creates valid, non-duplicate connections', () => {
    const nodes = [...initialNodes, { id: 'free', kind: 'agent' as const, title: 'Free', detail: '', x: 0, y: 0, instructions: '' }];
    expect(connect(initialNodes, initialEdges, 'trigger', 'triage')).toEqual(initialEdges);
    expect(connect(initialNodes, initialEdges, 'trigger', 'context')).toEqual(initialEdges);
    expect(connect(initialNodes, initialEdges, 'trigger', 'missing')).toEqual(initialEdges);
    expect(connect(initialNodes, initialEdges, 'plan', 'trigger')).toEqual(initialEdges);
    expect(connect(initialNodes, initialEdges, 'action', 'free')).toEqual(initialEdges);
    expect(connect(nodes, initialEdges, 'approval', 'free')).toEqual(initialEdges);
    expect(connectionError(initialNodes, initialEdges, 'triage', 'context')).toBe('That connection would create a loop.');
  });

  test('a step with an output is refused a second output until its connection is removed', () => {
    const nodes = [...starterNodes, { id: 'memory', kind: 'memory' as const, title: 'Memory', detail: '', x: 0, y: 0, instructions: '' }];
    expect(connectionError(nodes, starterEdges, 'trigger', 'end')).toMatch(/already connected/);
    expect(connectionError(nodes, starterEdges, 'agent', 'trigger')).toBeDefined();
    expect(connectionError(nodes, [], 'trigger', 'end')).toBeUndefined();
  });

  test('connecting an unlinked step splices it into the chain in either direction', () => {
    const nodes = [...starterNodes, { id: 'memory', kind: 'memory' as const, title: 'Memory', detail: '', x: 0, y: 0, instructions: '' }];
    const before = connect(nodes, starterEdges, 'memory', 'agent');
    expect(before.map((edge) => `${edge.from}>${edge.to}`).sort()).toEqual(['agent>end', 'memory>agent', 'trigger>memory']);
    const after = connect(nodes, starterEdges, 'agent', 'memory');
    expect(after.map((edge) => `${edge.from}>${edge.to}`).sort()).toEqual(['agent>memory', 'memory>end', 'trigger>agent']);
  });

  test('a condition needs a branch and keeps it when a step is inserted', () => {
    const nodes = [...starterNodes, { id: 'condition', kind: 'condition' as const, title: 'Condition', detail: '', x: 0, y: 0, instructions: '' }];
    const edges = [{ id: 'trigger-condition', from: 'trigger', to: 'condition' }, { id: 'condition-end', from: 'condition', to: 'end', branch: 'true' as const }];
    expect(connectionError(nodes, edges, 'condition', 'agent')).toMatch(/True or False/);
    expect(connectionError(nodes, edges, 'trigger', 'agent', 'true')).toMatch(/Only a Condition/);
    const inserted = connect(nodes, edges, 'condition', 'agent', 'true');
    expect(inserted).toContainEqual({ id: 'condition-agent-true', from: 'condition', to: 'agent', branch: 'true' });
    expect(inserted).toContainEqual({ id: 'agent-end', from: 'agent', to: 'end' });
    expect(connect(nodes, edges, 'condition', 'agent', 'false')).toContainEqual({ id: 'condition-agent-false', from: 'condition', to: 'agent', branch: 'false' });
  });

  test('offers only preceding typed condition sources and prevents duplicate branches', () => {
    const nodes = [...starterNodes, { id: 'condition', kind: 'condition' as const, title: 'Condition', detail: '', x: 0, y: 0, instructions: '', config: { source: 'agent', field: 'result', equals: 'ready' } }];
    const edges = [...starterEdges.slice(0, 1), { id: 'agent-condition', from: 'agent', to: 'condition' }];
    expect(conditionSources(nodes, edges, 'condition').map((node) => node.id)).toEqual(['trigger', 'agent']);
    expect(conditionFields(nodes[1]!)).toEqual([['result', 'string']]);
    const branched = connect(nodes, [...edges, { id: 'condition-end-true', from: 'condition', to: 'end', branch: 'true' as const }], 'condition', 'agent', 'true');
    expect(branched).toHaveLength(3);
  });

  test('removes a connection by id', () => {
    expect(disconnect(initialEdges, 'trigger-context')).not.toContainEqual(expect.objectContaining({ id: 'trigger-context' }));
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

  test('filters library groups by label, kind, or help text, and drops empty groups', () => {
    const groups = [{ title: 'Logic', items: [{ kind: 'trigger' as const, label: 'Trigger' }, { kind: 'agent' as const, label: 'Agent step' }] }, { title: 'Knowledge', items: [{ kind: 'memory' as const, label: 'Memory' }] }];
    const help = { memory: 'Reads permitted, bounded workflow memory.' };
    expect(filterLibrary(groups, '', help)).toEqual(groups);
    expect(filterLibrary(groups, 'bounded workflow', help)).toEqual([{ title: 'Knowledge', items: [{ kind: 'memory', label: 'Memory' }] }]);
    expect(filterLibrary(groups, 'nonexistent', help)).toEqual([]);
  });

  test('validates a trigger field name against emptiness, shape, and duplicates', () => {
    const schema = setSchemaField({ type: 'object', properties: {}, required: [], additionalProperties: false }, 'priority', 'number', true);
    expect(schemaFieldNameError(schema, '')).toBe('Enter a field name.');
    expect(schemaFieldNameError(schema, '1bad')).toBe('Use letters, numbers, and underscores; start with a letter.');
    expect(schemaFieldNameError(schema, 'priority')).toBe('priority already exists.');
    expect(schemaFieldNameError(schema, 'priority', 'priority')).toBeUndefined();
    expect(schemaFieldNameError(schema, 'other')).toBeUndefined();
  });

  const node = (id: string, kind: WorkflowNode['kind'], config: Record<string, unknown> = {}): WorkflowNode => ({ id, kind, title: id, detail: '', x: 0, y: 0, instructions: '', config });
  const flow = (from: string, to: string, branch?: 'true' | 'false'): WorkflowEdge => ({ id: `${from}-${to}${branch ? `-${branch}` : ''}`, from, to, ...(branch ? { branch } : {}) });
  const toolEdge = (from: string, to: string): WorkflowEdge => ({ id: `${from}-${to}-tool`, from, to, role: 'tool' });
  const agentConfig = { policy: { milliseconds: 1, attempts: 1, tokens: 1, cost: 1, toolRounds: 0, effects: 0 }, responseSchema: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'], additionalProperties: false } };

  describe('branches, joins and tools', () => {
    test('an Agent that only has a tool edge can still lead to another Agent', () => {
      const nodes = [node('trigger', 'trigger'), node('one', 'agent', agentConfig), node('two', 'agent', agentConfig), node('crm', 'mcp'), node('end', 'end')];
      const edges = [flow('trigger', 'one'), flow('two', 'end'), flow('trigger', 'two'), toolEdge('one', 'crm')];
      expect(connectionError(nodes, edges, 'one', 'two')).toBeUndefined();
      const joined = connect(nodes, edges, 'one', 'two');
      expect(joined).toContainEqual({ id: 'one-two', from: 'one', to: 'two' });
      expect(connectionError(nodes, joined, 'one', 'end')).toMatch(/already connected/);
    });

    test('both Condition branches can lead to the same End and get distinct edge ids', () => {
      const nodes = [node('trigger', 'trigger'), node('check', 'condition'), node('end', 'end')];
      const first = connect(nodes, [flow('trigger', 'check')], 'check', 'end', 'true');
      const second = connect(nodes, first, 'check', 'end', 'false');
      expect(second.map((edge) => edge.id)).toEqual(['trigger-check', 'check-end-true', 'check-end-false']);
      expect(connectionError(nodes, second, 'check', 'end', 'false')).toMatch(/already connected/);
    });

    test('a Condition branch can join a step that already has an input, but an occupied branch is refused', () => {
      const nodes = [node('trigger', 'trigger'), node('check', 'condition'), node('one', 'agent', agentConfig), node('two', 'agent', agentConfig), node('end', 'end')];
      const edges = [flow('trigger', 'check'), flow('check', 'one', 'true'), flow('one', 'end')];
      expect(connect(nodes, edges, 'check', 'end', 'false')).toContainEqual({ id: 'check-end-false', from: 'check', to: 'end', branch: 'false' });
      expect(connectionError(nodes, [...edges, flow('check', 'end', 'false')], 'check', 'two', 'true')).toBeUndefined();
      expect(connectionError(nodes, [...edges, flow('check', 'end', 'false'), flow('trigger', 'two')], 'check', 'two', 'true')).toMatch(/branch already leads/);
    });

    test('joins never create a loop', () => {
      const nodes = [node('trigger', 'trigger'), node('check', 'condition'), node('one', 'agent', agentConfig), node('two', 'agent', agentConfig)];
      const edges = [flow('trigger', 'check'), flow('check', 'one', 'true'), flow('one', 'two')];
      expect(connectionError(nodes, edges, 'two', 'check')).toBe('That connection would create a loop.');
      expect(connectionError(nodes, edges, 'two', 'one')).toBe('That connection would create a loop.');
    });

    test('a tool MCP cannot be a flow endpoint and a flow MCP cannot become a tool', () => {
      const nodes = [node('trigger', 'trigger'), node('one', 'agent', agentConfig), node('two', 'agent', agentConfig), node('crm', 'mcp'), node('step', 'mcp'), node('end', 'end')];
      const edges = [flow('trigger', 'one'), flow('one', 'step'), toolEdge('one', 'crm')];
      expect(connectionError(nodes, edges, 'crm', 'end')).toMatch(/attached to an Agent as a tool/);
      expect(connectionError(nodes, edges, 'step', 'end')).toBeUndefined();
      expect(toolError(nodes, edges, 'one', 'step')).toMatch(/already in the flow/);
      expect(toolError(nodes, edges, 'two', 'crm')).toMatch(/another Agent/);
      expect(toolError(nodes, edges, 'one', 'crm')).toMatch(/already a tool of this Agent/);
      expect(toolError(nodes, edges, 'trigger', 'crm')).toMatch(/Only an Agent/);
      expect(toolError(nodes, edges, 'two', 'end')).toMatch(/Only an MCP/);
    });

    test('an Agent takes up to sixteen tools and attaching one prepares the tool and the agent policy', () => {
      const mcps = Array.from({ length: 17 }, (_, index) => node(`m${index}`, 'mcp', { arguments: { q: '$input.q' } }));
      let state = { nodes: [node('agent', 'agent', agentConfig), ...mcps], edges: [] as WorkflowEdge[] };
      for (const item of mcps.slice(0, 16)) state = attachTool(state.nodes, state.edges, 'agent', item.id);
      expect(toolsOf(state.nodes, state.edges, 'agent')).toHaveLength(16);
      expect(toolError(state.nodes, state.edges, 'agent', 'm16')).toMatch(/at most 16/);
      expect(state.nodes[0]?.config?.['policy']).toMatchObject({ toolRounds: 3, effects: 3 });
      expect(state.nodes[1]?.config?.['arguments']).toEqual({});
      expect(attachTool(state.nodes, state.edges, 'agent', 'm16').edges).toEqual(state.edges);
    });

    test('a Memory step can be attached as the one Memory tool of an Agent, next to MCP tools', () => {
      const memoryConfig = { limit: 3, maxChars: 2000, policy: { milliseconds: 30000, attempts: 1, tokens: 0, cost: 0, toolRounds: 0, effects: 0 } };
      const nodes = [node('trigger', 'trigger'), node('one', 'agent', agentConfig), node('two', 'agent', agentConfig), node('crm', 'mcp'), node('recall', 'memory', memoryConfig), node('extra', 'memory', memoryConfig), node('end', 'end')];
      const start = attachTool(nodes, [flow('trigger', 'one'), flow('one', 'end')], 'one', 'crm');
      const withMemory = attachTool(start.nodes, start.edges, 'one', 'recall');
      expect(toolsOf(withMemory.nodes, withMemory.edges, 'one').map((item) => item.id)).toEqual(['crm', 'recall']);
      expect(withMemory.nodes.find((item) => item.id === 'recall')?.config).toEqual(memoryConfig);
      expect(toolError(withMemory.nodes, withMemory.edges, 'one', 'extra')).toBe('An Agent can have only one Memory tool.');
      expect(toolError(withMemory.nodes, withMemory.edges, 'two', 'recall')).toMatch(/another Agent/);
      expect(toolError(withMemory.nodes, withMemory.edges, 'one', 'recall')).toMatch(/already a tool of this Agent/);
      expect(toolError(withMemory.nodes, withMemory.edges, 'two', 'extra')).toBeUndefined();
      expect(connectionError(withMemory.nodes, withMemory.edges, 'recall', 'end')).toMatch(/attached to an Agent as a tool/);
      expect(connectionError(withMemory.nodes, withMemory.edges, 'trigger', 'recall')).toMatch(/attached to an Agent as a tool/);
    });

    test('a Memory step already in the flow cannot become a tool and Memory tools do not count as chain grants', () => {
      const nodes = [node('trigger', 'trigger'), node('one', 'agent', agentConfig), node('read', 'memory'), node('end', 'end')];
      const edges = [flow('trigger', 'read'), flow('read', 'one'), flow('one', 'end')];
      expect(toolError(nodes, edges, 'one', 'read')).toMatch(/already in the flow/);
      const tooled = attachTool([node('trigger', 'trigger'), node('one', 'agent', agentConfig), node('recall', 'memory')], [flow('trigger', 'one')], 'one', 'recall');
      expect(syncChainGrants(tooled.nodes, tooled.edges).find((item) => item.id === 'one')?.config?.['allowedCapabilities']).toBeUndefined();
    });

    test('memory tools count toward the sixteen-tool limit', () => {
      const mcps = Array.from({ length: 16 }, (_, index) => node(`m${index}`, 'mcp'));
      let state = { nodes: [node('agent', 'agent', agentConfig), node('recall', 'memory'), ...mcps], edges: [] as WorkflowEdge[] };
      for (const item of mcps) state = attachTool(state.nodes, state.edges, 'agent', item.id);
      expect(toolError(state.nodes, state.edges, 'agent', 'recall')).toMatch(/at most 16/);
    });

    test('an existing tool budget is kept when a tool is attached', () => {
      const agent = node('agent', 'agent', { ...agentConfig, policy: { ...agentConfig.policy, toolRounds: 5, effects: 2 } });
      expect(attachTool([agent, node('crm', 'mcp')], [], 'agent', 'crm').nodes[0]?.config?.['policy']).toMatchObject({ toolRounds: 5, effects: 2 });
    });

    test('mapping and condition sources include only fields on every path to the target', () => {
      const output = { type: 'object', properties: { found: { type: 'string' }, ok: { type: 'boolean' } } };
      const outputs = (candidate: WorkflowNode) => candidate.id === 'read' ? output : undefined;
      const nodes = [node('trigger', 'trigger', { inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }), node('check', 'condition'), node('left', 'agent', agentConfig), node('right', 'agent', agentConfig), node('join', 'agent', agentConfig), node('read', 'mcp'), node('next', 'mcp'), node('gate', 'condition'), node('crm', 'mcp')];
      const edges = [flow('trigger', 'check'), flow('check', 'left', 'true'), flow('check', 'right', 'false'), flow('left', 'join'), flow('right', 'join'), flow('join', 'read'), flow('read', 'next'), flow('next', 'gate'), toolEdge('join', 'crm')];
      expect(mappingFields(nodes, edges, 'next', 'string', outputs).map(([value]) => value)).toEqual(['$input.text', '$node.join.result', '$node.read.found']);
      expect(mappingFields(nodes, edges, 'join', 'string', outputs).map(([value]) => value)).toEqual(['$input.text']);
      expect(conditionSources(nodes, edges, 'gate', outputs).map((item) => item.id)).toEqual(['trigger', 'join', 'read']);
      expect(conditionFields(nodes.find((item) => item.id === 'read')!, outputs)).toEqual([['found', 'string'], ['ok', 'boolean']]);
      expect(conditionSources(nodes, edges, 'gate').map((item) => item.id)).toEqual(['trigger', 'join']);
    });
  });

  test('a chain-step MCP is granted on its nearest dominating Agent and tool MCPs are not', () => {
    const nodes = [node('trigger', 'trigger'), node('one', 'agent', agentConfig), node('two', 'agent', { ...agentConfig, allowedCapabilities: ['other'] }), node('step', 'mcp', { capability: 'write' }), node('crm', 'mcp', { capability: 'lookup' }), node('unlinked', 'mcp', { capability: 'lost' })];
    const edges = [flow('trigger', 'one'), flow('one', 'two'), flow('two', 'step'), toolEdge('one', 'crm')];
    const synced = syncChainGrants(nodes, edges);
    expect(synced.find((item) => item.id === 'two')?.config?.['allowedCapabilities']).toEqual(['other', 'write']);
    expect(synced.find((item) => item.id === 'one')?.config?.['allowedCapabilities']).toBeUndefined();
    expect(syncChainGrants(synced, edges)).toEqual(synced);
  });
});

test('a new step never reuses the id of a step loaded from a saved revision', () => {
  const stub = (id: string, kind: WorkflowNode['kind']): WorkflowNode => ({ id, kind, title: id, detail: '', x: 0, y: 0, instructions: '' });
  const loaded = [stub('mcp-1', 'mcp'), stub('mcp-2', 'mcp'), stub('agent-1', 'agent')];
  expect(freeSequence(loaded, 'mcp', 1)).toBe(3);
  expect(freeSequence(loaded, 'memory', 1)).toBe(1);
  expect(freeSequence(loaded, 'agent', 2)).toBe(2);
  expect(createNode('mcp', 0, 0, freeSequence(loaded, 'mcp', 1)).id).toBe('mcp-3');
});

describe('memory provenance for Studio', () => {
  test('a v2 item shows subjects, observation date, supersession links and the consolidation decision', () => {
    expect(memoryProvenance({ schemaVersion: 2, subjects: ['npm:zod'], observedAt: '2026-10-04T10:00:00.000Z', predecessorId: 'old-id', consolidation: { decision: 'supersede', path: 'model', targetId: 'old-id' } })).toBe('subjects npm:zod · observed 2026-10-04 · supersedes old-id · consolidation supersede via model → old-id');
    expect(memoryProvenance({ schemaVersion: 2, subjects: [], supersededBy: 'new-id' })).toBe('subjects none · observed unknown · superseded by new-id');
  });

  test('a v1 item is labelled legacy and a receipt without rank reads none', () => {
    expect(memoryProvenance({ type: 'task-fact' })).toBe('legacy item');
    expect(retrievalRank({})).toBe('none');
  });

  test('rank inputs are listed per returned item', () => {
    expect(retrievalRank({ rank: [{ id: 'a', score: 0.8, recency: 0.5, typeWeight: 0.9 }, { id: 'b', score: 'x' }] })).toBe('a (relevance 0.80, recency 0.50, type 0.90); b (relevance ?, recency ?, type ?)');
  });
});
