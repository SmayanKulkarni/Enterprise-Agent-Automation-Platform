import { describe, expect, test } from 'vitest';
import { compileGraph, validateGraph, type CapabilityPin, type GraphDraft, type GraphEdge, type GraphNode, type JsonSchema, type NodePolicy } from './graph.js';

const installationId = '66666666-6666-4666-8666-666666666666';
const grantId = '77777777-7777-4777-8777-777777777777';
const manifestDigest = 'a'.repeat(64);
const policy: NodePolicy = { milliseconds: 30000, attempts: 1, tokens: 1000, cost: 1, toolRounds: 2, effects: 2 };
const result = { type: 'object' as const, properties: { result: { type: 'string' as const } }, required: ['result'], additionalProperties: false as const };
const query = { type: 'object' as const, properties: { query: { type: 'string' as const } }, required: ['query'], additionalProperties: false as const };
const input = { type: 'object' as const, properties: { flag: { type: 'boolean' as const }, text: { type: 'string' as const } }, required: ['flag'], additionalProperties: false as const };
const node = (id: string, kind: string, config: Record<string, unknown>): GraphNode => ({ id, kind, title: id, detail: '', x: 1, y: 1, instructions: kind === 'agent' ? 'Act.' : '', config });
const agent = (id: string, overrides: Record<string, unknown> = {}): GraphNode => node(id, 'agent', { provider: 'azure-openai', model: 'gpt-4.1', promptVersion: '1', responseSchema: result, policy, allowedCapabilities: [], ...overrides });
const trigger = node('start', 'trigger', { mode: 'manual', inputSchema: input });
const end = (id = 'end'): GraphNode => node(id, 'end', {});
const tool = (id: string, capability = 'lookup'): GraphNode => node(id, 'mcp', { installationId, capability, manifestDigest, grantId, target: 'crm', arguments: {}, policy });
const chain = (id: string, args: Record<string, unknown>, capability = 'read'): GraphNode => node(id, 'mcp', { installationId, capability, manifestDigest, grantId, target: 'crm', arguments: args, policy });
const flow = (from: string, to: string, branch?: 'true' | 'false'): GraphEdge => ({ id: `${from}-${to}${branch ? `-${branch}` : ''}`, from, to, ...(branch ? { branch } : {}) });
const memoryTool = (id: string): GraphNode => node(id, 'memory', { limit: 3, maxChars: 500, policy: { milliseconds: 30000, attempts: 1, tokens: 0, cost: 0, toolRounds: 0, effects: 0 } });
const attach = (from: string, to: string): GraphEdge => ({ id: `${from}-${to}-tool`, from, to, role: 'tool' });
const draft = (nodes: GraphNode[], edges: GraphEdge[]): GraphDraft => ({ kind: 'graph-v1', nodes, edges });
const pin = (nodeId: string, capability: string, risk: CapabilityPin['risk'] = 'R2', inputSchema: JsonSchema = query, outputSchema: JsonSchema = result): CapabilityPin => ({ nodeId, installationId, capability, manifestDigest, grantId, risk, inputSchema, outputSchema });
const codes = (graph: GraphDraft, pins: CapabilityPin[] = []): string[] => validateGraph(graph, pins).map((item) => item.code);

const toolGraph = (): GraphDraft => draft([trigger, agent('agent'), tool('crm'), end()], [flow('start', 'agent'), flow('agent', 'end'), attach('agent', 'crm')]);
const toolPins = [pin('crm', 'lookup')];

describe('legacy definitions', () => {
  test('compile to the same digest as before tool edges existed', async () => {
    const legacyPolicy = { milliseconds: 30000, attempts: 1, tokens: 1000, cost: 1, toolRounds: 1, effects: 1 };
    const legacyNode = (id: string, kind: string, config: Record<string, unknown>): GraphNode => ({ id, kind, title: id, detail: '', x: 1, y: 1, instructions: kind === 'agent' ? 'Classify.' : '', config });
    const empty = { type: 'object' as const, properties: {}, required: [], additionalProperties: false as const };
    const legacy = draft([legacyNode('trigger', 'trigger', { mode: 'manual', inputSchema: empty }), legacyNode('agent', 'agent', { provider: 'azure-openai', model: 'gpt-4.1', promptVersion: '1', responseSchema: result, policy: legacyPolicy, allowedCapabilities: ['write'] }), legacyNode('condition', 'condition', { source: 'agent', field: 'result', equals: 'approve' }), legacyNode('approval', 'approval', { timeoutMs: 3600000 }), legacyNode('mcp', 'mcp', { installationId, capability: 'write', manifestDigest, grantId, target: 'account', arguments: { result: '$node.agent.result' }, policy: legacyPolicy }), end('done'), end('denied')], [{ id: 'a', from: 'trigger', to: 'agent' }, { id: 'b', from: 'agent', to: 'condition' }, { id: 'c', from: 'condition', to: 'approval', branch: 'true' }, { id: 'd', from: 'condition', to: 'denied', branch: 'false' }, { id: 'e', from: 'approval', to: 'mcp' }, { id: 'f', from: 'mcp', to: 'done' }]);
    const compiled = await compileGraph('11111111-1111-4111-8111-111111111111', 1, legacy, [pin('mcp', 'write', 'R2', result)]);
    expect(compiled.digest).toBe('1ac4d4576c99272c5361f9c9a6ac309ed633bbadd7ac449061c46f474b84c988');
  });
});

describe('branches and joins', () => {
  const routed = (edges: GraphEdge[]): GraphDraft => draft([trigger, node('check', 'condition', { source: 'input', field: 'flag', equals: true }), end('yes'), end('no')], [flow('start', 'check'), ...edges]);

  test('both branches may lead to the same End', () => {
    const graph = draft([trigger, node('check', 'condition', { source: 'input', field: 'flag', equals: true }), end()], [flow('start', 'check'), flow('check', 'end', 'true'), flow('check', 'end', 'false')]);
    expect(codes(graph)).toEqual([]);
  });

  test('an unconnected branch completes the run and compiles to null', async () => {
    const graph = routed([flow('check', 'yes', 'true'), flow('check', 'no', 'false')]);
    graph.nodes = graph.nodes.filter((item) => item.id !== 'no'); graph.edges = graph.edges.filter((item) => item.to !== 'no');
    expect(codes(graph)).toEqual([]);
    const compiled = await compileGraph('11111111-1111-4111-8111-111111111111', 1, graph, []);
    expect(compiled.nodes.find((item) => item.id === 'check')?.next).toEqual({ true: 'yes', false: null });
  });

  test('a Condition with no connected branch, or a duplicate branch, is refused', () => {
    expect(codes(routed([]))).toContain('INVALID_SUCCESSOR');
    expect(codes(routed([flow('check', 'yes', 'true'), { id: 'again', from: 'check', to: 'no', branch: 'true' }]))).toContain('INVALID_SUCCESSOR');
  });

  test('a mapping source must lie on every path to its target', () => {
    const graph = (source: string): GraphDraft => draft([trigger, node('check', 'condition', { source: 'input', field: 'flag', equals: true }), agent('left'), agent('right'), agent('join'), chain('read', { query: `$node.${source}.result` }), end()], [flow('start', 'check'), flow('check', 'left', 'true'), flow('check', 'right', 'false'), flow('left', 'join'), flow('right', 'join'), flow('join', 'read'), flow('read', 'end')]);
    const pins = [pin('read', 'read', 'R1', query)];
    const withGrant = (value: GraphDraft): GraphDraft => ({ ...value, nodes: value.nodes.map((item) => item.id === 'join' ? agent('join', { allowedCapabilities: ['read'] }) : item) });
    expect(codes(withGrant(graph('left')), pins)).toContain('INVALID_MAPPING');
    expect(codes(withGrant(graph('join')), pins)).toEqual([]);
  });

  test('cycles through a join are still refused', () => {
    const graph = draft([trigger, agent('a'), agent('b'), end()], [flow('start', 'a'), flow('a', 'b'), flow('b', 'a')]);
    expect(codes(graph)).toEqual(expect.arrayContaining(['CYCLE']));
  });

  test('a Condition can test the output of a chain step MCP', () => {
    const graph = draft([trigger, agent('agent', { allowedCapabilities: ['read'] }), chain('read', { query: '$input.text' }), node('check', 'condition', { source: 'read', field: 'result', equals: 'ok' }), end('yes'), end('no')], [flow('start', 'agent'), flow('agent', 'read'), flow('read', 'check'), flow('check', 'yes', 'true'), flow('check', 'no', 'false')]);
    expect(codes(graph, [pin('read', 'read', 'R1')])).toEqual([]);
  });
});

describe('tool edges', () => {
  test('an Agent with an attached tool validates and derives its capabilities at compile time', async () => {
    expect(codes(toolGraph(), toolPins)).toEqual([]);
    const compiled = await compileGraph('11111111-1111-4111-8111-111111111111', 1, toolGraph(), toolPins);
    const agentNode = compiled.nodes.find((item) => item.id === 'agent'); const toolNode = compiled.nodes.find((item) => item.id === 'crm');
    expect(agentNode).toMatchObject({ tools: ['crm'], next: 'end', config: { allowedCapabilities: ['lookup'] } });
    expect(toolNode).toMatchObject({ tool: true, next: null, config: { arguments: {} } });
    expect(compiled.capabilityPins.map((item) => item.nodeId)).toEqual(['crm']);
  });

  test('an Agent may have several tools and the tool node needs no flow input', () => {
    const graph = draft([trigger, agent('agent'), tool('crm'), tool('files', 'files.read'), end()], [flow('start', 'agent'), flow('agent', 'end'), attach('agent', 'crm'), attach('agent', 'files')]);
    expect(codes(graph, [...toolPins, pin('files', 'files.read')])).toEqual([]);
  });

  test('a tool with flow edges, two owners, a non-Agent owner or a duplicate capability is refused', () => {
    const chained = toolGraph(); chained.edges.push(flow('crm', 'end'));
    expect(codes(chained, toolPins)).toContain('INVALID_TOOL_EDGE');
    const shared = draft([trigger, agent('one'), agent('two'), tool('crm'), end()], [flow('start', 'one'), flow('one', 'two'), flow('two', 'end'), attach('one', 'crm'), attach('two', 'crm')]);
    expect(codes(shared, toolPins)).toContain('INVALID_TOOL_EDGE');
    const wrongOwner = toolGraph(); wrongOwner.edges[2] = attach('start', 'crm');
    expect(codes(wrongOwner, toolPins)).toContain('INVALID_TOOL_EDGE');
    const twin = draft([trigger, agent('agent'), tool('one'), tool('two'), end()], [flow('start', 'agent'), flow('agent', 'end'), attach('agent', 'one'), attach('agent', 'two')]);
    expect(codes(twin, [pin('one', 'lookup'), pin('two', 'lookup')])).toContain('DUPLICATE_TOOL');
  });

  test('an Agent with tools needs tool rounds and effects in its policy', () => {
    const graph = toolGraph(); graph.nodes[1] = agent('agent', { policy: { ...policy, toolRounds: 0 } });
    expect(codes(graph, toolPins)).toContain('TOOL_POLICY_REQUIRED');
  });

  test('a tool without a grant is refused', () => {
    expect(codes(toolGraph(), [])).toContain('UNGRANTED_CAPABILITY');
  });

  test('a tool edge must not use a branch', () => {
    const graph = toolGraph(); graph.edges[2] = { ...attach('agent', 'crm'), branch: 'true' };
    expect(codes(graph, toolPins)).toContain('INVALID_TOOL_EDGE');
  });

  test('a tool is never a data source', () => {
    const graph = draft([trigger, agent('agent'), tool('crm'), chain('read', { query: '$node.crm.result' }), end()], [flow('start', 'agent'), flow('agent', 'read'), flow('read', 'end'), attach('agent', 'crm')]);
    expect(codes(graph, [...toolPins, pin('read', 'read', 'R1')])).toContain('INVALID_MAPPING');
  });

  test('an Agent may attach one Memory tool next to several MCPs and its capabilities ignore the memory node', async () => {
    const graph = draft([trigger, agent('agent'), tool('crm'), memoryTool('recall'), end()], [flow('start', 'agent'), flow('agent', 'end'), attach('agent', 'crm'), attach('agent', 'recall')]);
    expect(codes(graph, toolPins)).toEqual([]);
    const compiled = await compileGraph('11111111-1111-4111-8111-111111111111', 1, graph, toolPins);
    expect(compiled.nodes.find((item) => item.id === 'agent')).toMatchObject({ tools: ['crm', 'recall'], config: { allowedCapabilities: ['lookup'] } });
    expect(compiled.nodes.find((item) => item.id === 'recall')).toEqual({ id: 'recall', kind: 'memory', config: memoryTool('recall').config, tool: true, next: null });
    expect(compiled.capabilityPins.map((item) => item.nodeId)).toEqual(['crm']);
  });

  test('an Agent with only a Memory tool needs no pins and keeps its authored capabilities untouched', async () => {
    const graph = draft([trigger, agent('agent'), memoryTool('recall'), end()], [flow('start', 'agent'), flow('agent', 'end'), attach('agent', 'recall')]);
    expect(codes(graph)).toEqual([]);
    const compiled = await compileGraph('11111111-1111-4111-8111-111111111111', 1, graph, []);
    expect(compiled.nodes.find((item) => item.id === 'agent')?.config['allowedCapabilities']).toEqual([]);
    expect(compiled.capabilityPins).toEqual([]);
  });

  test('a Memory tool with flow edges, a second owner, a non-Agent owner or a twin Memory tool is refused', () => {
    const base = (): GraphDraft => draft([trigger, agent('agent'), memoryTool('recall'), end()], [flow('start', 'agent'), flow('agent', 'end'), attach('agent', 'recall')]);
    const inbound = base(); inbound.edges.push(flow('start', 'recall'));
    expect(codes(inbound)).toContain('INVALID_TOOL_EDGE');
    const outbound = base(); outbound.edges.push(flow('recall', 'end'));
    expect(codes(outbound)).toContain('INVALID_TOOL_EDGE');
    const shared = draft([trigger, agent('one'), agent('two'), memoryTool('recall'), end()], [flow('start', 'one'), flow('one', 'two'), flow('two', 'end'), attach('one', 'recall'), attach('two', 'recall')]);
    expect(codes(shared)).toContain('INVALID_TOOL_EDGE');
    const wrongOwner = base(); wrongOwner.edges[2] = attach('start', 'recall');
    expect(codes(wrongOwner)).toContain('INVALID_TOOL_EDGE');
    const twin = draft([trigger, agent('agent'), memoryTool('one'), memoryTool('two'), end()], [flow('start', 'agent'), flow('agent', 'end'), attach('agent', 'one'), attach('agent', 'two')]);
    expect(codes(twin)).toContain('DUPLICATE_TOOL');
  });

  test('a Memory tool node must still carry valid memory settings and the Agent still needs tool policy', () => {
    const broken = draft([trigger, agent('agent'), node('recall', 'memory', { limit: 99, maxChars: 500, policy }), end()], [flow('start', 'agent'), flow('agent', 'end'), attach('agent', 'recall')]);
    expect(codes(broken)).toContain('INVALID_MEMORY');
    const noRounds = draft([trigger, agent('agent', { policy: { ...policy, effects: 0 } }), memoryTool('recall'), end()], [flow('start', 'agent'), flow('agent', 'end'), attach('agent', 'recall')]);
    expect(codes(noRounds)).toContain('TOOL_POLICY_REQUIRED');
  });

  test('the tool limit counts Memory and MCP targets together', () => {
    const many = Array.from({ length: 16 }, (_, index) => tool(`t${index}`, `cap${index}`));
    const pins = many.map((item) => pin(item.id, String(item.config['capability'])));
    const full = draft([trigger, agent('agent'), ...many, end()], [flow('start', 'agent'), flow('agent', 'end'), ...many.map((item) => attach('agent', item.id))]);
    expect(codes(full, pins)).toEqual([]);
    const over = draft([trigger, agent('agent'), ...many, memoryTool('recall'), end()], [flow('start', 'agent'), flow('agent', 'end'), ...many.map((item) => attach('agent', item.id)), attach('agent', 'recall')]);
    expect(codes(over, pins)).toContain('TOO_MANY_TOOLS');
  });

  test('a Memory step in the flow stays a step and cannot double as a tool', () => {
    const graph = draft([trigger, agent('agent'), node('read', 'memory', { limit: 3, maxChars: 500, policy }), end()], [flow('start', 'read'), flow('read', 'agent'), flow('agent', 'end'), attach('agent', 'read')]);
    expect(codes(graph)).toContain('INVALID_TOOL_EDGE');
  });
});
