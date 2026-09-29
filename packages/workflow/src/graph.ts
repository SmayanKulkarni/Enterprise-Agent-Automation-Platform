import { digest } from '../../contracts/src/index.js';
import { dominators, immediateDominator, isFlowEdge, strictlyDominates } from './flow.js';

export type NodeKind = 'trigger' | 'memory' | 'agent' | 'condition' | 'approval' | 'mcp' | 'end';
export interface GraphNode { id: string; kind: string; title: string; detail: string; x: number; y: number; instructions: string; config: Record<string, unknown>; }
export interface GraphEdge { id: string; from: string; to: string; branch?: 'true' | 'false'; role?: 'tool'; }
export interface GraphDraft { kind: 'graph-v1'; nodes: GraphNode[]; edges: GraphEdge[]; }
export interface GraphIssue { path: string; code: string; message: string; }
export interface CapabilityPin { nodeId: string; installationId: string; capability: string; manifestDigest: string; grantId: string; risk: 'R1' | 'R2' | 'R3'; inputSchema: JsonSchema; outputSchema: JsonSchema; }
export interface NodePolicy { milliseconds: number; attempts: number; tokens: number; cost: number; toolRounds: number; effects: number; }
export interface JsonSchema { type: 'object'; properties: Record<string, { type: 'string' | 'number' | 'boolean' | 'object' | 'array' }>; required: string[]; additionalProperties: false; }
export interface CompiledNode { id: string; kind: NodeKind; config: Record<string, unknown>; instructions?: string; tools?: string[]; tool?: true; next: string | { true: string | null; false: string | null } | null; }
export interface WorkflowDefinition { id: string; revision: number; digest: string; start: string; nodes: readonly CompiledNode[]; capabilityPins: readonly CapabilityPin[]; }

export const MAX_AGENT_TOOLS = 16;
const kinds = new Set<NodeKind>(['trigger', 'memory', 'agent', 'condition', 'approval', 'mcp', 'end']);
const forbidden = /(?:token|secret|password|credential|api.?key|private.?key|authorization|connection.?string|cookie|bearer)/iu;
const messages: Record<string, string> = {
  INVALID_TOOL_EDGE: 'A tool edge runs from one Agent to one MCP step; that MCP step has no other connections.',
  DUPLICATE_TOOL: 'An Agent cannot have two tools with the same capability.',
  TOO_MANY_TOOLS: `An Agent can have at most ${MAX_AGENT_TOOLS} tools.`,
  TOOL_POLICY_REQUIRED: 'An Agent with tools needs at least one tool round and one external effect in its policy.',
  MISSING_INPUT: 'This step is not connected to a previous step.',
  TRIGGER_HAS_INPUT: 'The Trigger starts the workflow and cannot have an input.',
  INVALID_SUCCESSOR: 'This step has the wrong number of outputs; a Condition needs at least one branch connected.',
};
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const plain = (value: unknown): boolean => value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || Array.isArray(value) && value.every(plain) || object(value) && Object.entries(value).every(([key, child]) => (key === 'tokens' || !forbidden.test(key)) && plain(child));
const fields = (value: Record<string, unknown>, names: readonly string[]): boolean => Object.keys(value).every((key) => names.includes(key));
export const validateSchema = (value: unknown): value is JsonSchema => object(value) && fields(value, ['type', 'properties', 'required', 'additionalProperties']) && value['type'] === 'object' && value['additionalProperties'] === false && object(value['properties']) && Object.values(value['properties']).every((property) => object(property) && fields(property, ['type']) && ['string', 'number', 'boolean', 'object', 'array'].includes(String(property['type']))) && Array.isArray(value['required']) && value['required'].every((key: unknown) => typeof key === 'string' && key in (value['properties'] as object));
const schema = validateSchema;
const proposalSchema = (value: JsonSchema): boolean => value.properties['memoryProposals'] === undefined || value.properties['memoryProposals']?.type === 'array' && !value.required.includes('memoryProposals');
const policy = (value: unknown): value is NodePolicy => object(value) && fields(value, ['milliseconds', 'attempts', 'tokens', 'cost', 'toolRounds', 'effects']) && Number.isSafeInteger(value['milliseconds']) && Number(value['milliseconds']) > 0 && Number(value['milliseconds']) <= 86400000 && Number.isSafeInteger(value['attempts']) && Number(value['attempts']) > 0 && Number(value['attempts']) <= 5 && Number.isSafeInteger(value['tokens']) && Number(value['tokens']) >= 0 && Number(value['tokens']) <= 100000 && typeof value['cost'] === 'number' && Number.isFinite(value['cost']) && value['cost'] >= 0 && value['cost'] <= 1000 && Number.isSafeInteger(value['toolRounds']) && Number(value['toolRounds']) >= 0 && Number(value['toolRounds']) <= 20 && Number.isSafeInteger(value['effects']) && Number(value['effects']) >= 0 && Number(value['effects']) <= 20;
const model = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._:-]*)?$/u.test(value);
const issue = (path: string, code: string): GraphIssue => ({ path, code, message: messages[code] ?? code.toLowerCase().replaceAll('_', ' ') });
const same = (left: unknown, right: unknown): boolean => String(left).toLowerCase() === String(right).toLowerCase();

export const pinFor = (pins: readonly CapabilityPin[], node: { id: string; config: Record<string, unknown> }): CapabilityPin | undefined => pins.find((item) => item.nodeId === node.id && same(item.installationId, node.config['installationId']) && item.capability === node.config['capability'] && item.manifestDigest === node.config['manifestDigest'] && same(item.grantId, node.config['grantId']));

export function validateValue(value: unknown, shape: JsonSchema): boolean {
  return object(value) && shape.required.every((key) => key in value) && Object.entries(value).every(([key, child]) => {
    const property = shape.properties[key];
    return property !== undefined && (property.type === 'object' ? object(child) && plain(child) : property.type === 'array' ? Array.isArray(child) && child.every(plain) : typeof child === property.type);
  });
}

const outputShape = (source: unknown, pins: readonly CapabilityPin[]): unknown => {
  if (!object(source) || !object(source['config'])) return undefined;
  const config = source['config'];
  if (source['kind'] === 'trigger') return config['inputSchema'];
  if (source['kind'] === 'agent') return config['responseSchema'];
  if (source['kind'] === 'mcp') return pins.find((item) => item.nodeId === source['id'] && same(item.installationId, config['installationId']) && item.capability === config['capability'])?.outputSchema;
  return undefined;
};

const argumentsMapped = (pin: CapabilityPin, args: Record<string, unknown>, nodes: readonly unknown[], pins: readonly CapabilityPin[]): boolean => pin.inputSchema.required.every((key) => key in args) && Object.entries(args).every(([key, child]) => {
  const targetType = pin.inputSchema.properties[key]?.type;
  if (!targetType) return false;
  if (typeof child !== 'string' || !child.startsWith('$')) return typeof child === targetType;
  const mapping = /^\$(input|node\.([a-zA-Z0-9_-]+))\.([a-zA-Z0-9_-]+)$/u.exec(child);
  if (!mapping) return false;
  const source = mapping[1] === 'input' ? nodes.find((item) => object(item) && item['kind'] === 'trigger') : nodes.find((item) => object(item) && item['id'] === mapping[2]);
  const shape = outputShape(source, pins);
  return schema(shape) && shape.properties[mapping[3]!]?.type === targetType;
});

function validateMcpNode(node: GraphNode, path: string, nodes: readonly unknown[], pins: readonly CapabilityPin[], isTool: boolean, issues: GraphIssue[]): void {
  const config = node.config; const pin = pinFor(pins, node); const args = config['arguments'];
  const mappingValid = pin !== undefined && object(args) && (isTool || argumentsMapped(pin, args, nodes, pins));
  if (!isTool && pin && object(args) && !mappingValid) {
    for (const name of pin.inputSchema.required) if (!(name in args)) issues.push(issue(`${path}/config/arguments/${name}`, 'MISSING_ARGUMENT'));
    for (const [name, value] of Object.entries(args)) {
      const expected = pin.inputSchema.properties[name]?.type;
      if (!expected || !(typeof value === 'string' && value.startsWith('$')) && typeof value !== expected) issues.push(issue(`${path}/config/arguments/${name}`, 'INVALID_MAPPING'));
    }
  }
  if (!(fields(config, ['installationId', 'capability', 'manifestDigest', 'grantId', 'target', 'arguments', 'policy']) && typeof config['target'] === 'string' && object(args) && policy(config['policy']) && config['policy'].effects >= 1 && pin && mappingValid)) issues.push(issue(`${path}/config`, 'UNGRANTED_CAPABILITY'));
}

function validateNodes(nodes: readonly unknown[], pins: readonly CapabilityPin[], toolTargets: ReadonlySet<string>, issues: GraphIssue[]): Map<string, GraphNode> {
  const byId = new Map<string, GraphNode>();
  nodes.forEach((raw, index) => {
    const path = `/nodes/${index}`;
    if (!object(raw) || !fields(raw, ['id', 'kind', 'title', 'detail', 'x', 'y', 'instructions', 'config']) || typeof raw['id'] !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/u.test(raw['id']) || typeof raw['title'] !== 'string' || typeof raw['detail'] !== 'string' || typeof raw['instructions'] !== 'string' || !Number.isFinite(raw['x']) || !Number.isFinite(raw['y']) || !object(raw['config'])) { issues.push(issue(path, 'INVALID_NODE')); return; }
    const node = raw as unknown as GraphNode;
    if (byId.has(node.id)) issues.push(issue(`${path}/id`, 'DUPLICATE_ID'));
    byId.set(node.id, node);
    if (!kinds.has(node.kind as NodeKind)) { issues.push(issue(`${path}/kind`, 'UNSUPPORTED_KIND')); return; }
    const config = node.config;
    if (node.kind === 'trigger' && !(fields(config, ['mode', 'inputSchema']) && ['manual', 'webhook'].includes(String(config['mode'])) && schema(config['inputSchema']))) issues.push(issue(`${path}/config`, 'INVALID_TRIGGER'));
    if (node.kind === 'memory' && !(fields(config, ['limit', 'maxChars', 'policy']) && Number.isSafeInteger(config['limit']) && Number(config['limit']) > 0 && Number(config['limit']) <= 20 && Number.isSafeInteger(config['maxChars']) && Number(config['maxChars']) > 0 && Number(config['maxChars']) <= 4000 && policy(config['policy']))) issues.push(issue(`${path}/config`, 'INVALID_MEMORY'));
    if (node.kind === 'agent' && !(fields(config, ['provider', 'model', 'fallback', 'promptVersion', 'responseSchema', 'policy', 'allowedCapabilities', 'openRouterOptIn']) && ['azure-openai', 'openrouter'].includes(String(config['provider'])) && model(config['model']) && (config['fallback'] === undefined || model(config['fallback']) && config['fallback'] !== config['model']) && typeof config['promptVersion'] === 'string' && config['promptVersion'].length > 0 && schema(config['responseSchema']) && proposalSchema(config['responseSchema']) && policy(config['policy']) && (config['allowedCapabilities'] === undefined || Array.isArray(config['allowedCapabilities']) && config['allowedCapabilities'].every((name: unknown) => typeof name === 'string')) && (config['provider'] !== 'openrouter' || config['openRouterOptIn'] === true))) issues.push(issue(`${path}/config`, 'INVALID_AGENT'));
    if (node.kind === 'condition' && !(fields(config, ['source', 'field', 'equals']) && typeof config['source'] === 'string' && typeof config['field'] === 'string' && ['string', 'number', 'boolean'].includes(typeof config['equals']))) issues.push(issue(`${path}/config`, 'INVALID_CONDITION'));
    if (node.kind === 'approval' && !(fields(config, ['timeoutMs']) && Number.isSafeInteger(config['timeoutMs']) && Number(config['timeoutMs']) > 0 && Number(config['timeoutMs']) <= 86400000)) issues.push(issue(`${path}/config`, 'INVALID_APPROVAL'));
    if (node.kind === 'mcp') validateMcpNode(node, path, nodes, pins, toolTargets.has(node.id), issues);
    if (node.kind === 'end' && !fields(config, [])) issues.push(issue(`${path}/config`, 'INVALID_END'));
  });
  return byId;
}

interface FlowModel { flow: GraphEdge[]; tools: GraphEdge[]; incoming: Map<string, GraphEdge[]>; outgoing: Map<string, GraphEdge[]>; toolsOf: Map<string, GraphEdge[]>; toolIn: Map<string, GraphEdge[]>; }

const toolEdgeValid = (edge: GraphEdge, byId: ReadonlyMap<string, GraphNode>): boolean => edge.role === 'tool' && edge.branch === undefined && byId.get(edge.from)?.kind === 'agent' && byId.get(edge.to)?.kind === 'mcp';
const group = (edges: readonly GraphEdge[], key: 'from' | 'to'): Map<string, GraphEdge[]> => edges.reduce((map, edge) => map.set(edge[key], [...(map.get(edge[key]) ?? []), edge]), new Map<string, GraphEdge[]>());

function validateEdges(edges: readonly unknown[], byId: ReadonlyMap<string, GraphNode>, issues: GraphIssue[]): FlowModel {
  const ids = new Set<string>(); const flow: GraphEdge[] = []; const tools: GraphEdge[] = [];
  edges.forEach((raw, index) => {
    const path = `/edges/${index}`;
    if (!object(raw) || !fields(raw, ['id', 'from', 'to', 'branch', 'role']) || typeof raw['id'] !== 'string' || typeof raw['from'] !== 'string' || typeof raw['to'] !== 'string' || !byId.has(raw['from']) || !byId.has(raw['to']) || raw['from'] === raw['to']) { issues.push(issue(path, 'DANGLING_EDGE')); return; }
    const edge = raw as unknown as GraphEdge;
    if (ids.has(edge.id)) issues.push(issue(`${path}/id`, 'DUPLICATE_ID'));
    ids.add(edge.id);
    if (edge.role === undefined) { flow.push(edge); return; }
    if (!toolEdgeValid(edge, byId)) issues.push(issue(path, 'INVALID_TOOL_EDGE'));
    tools.push(edge);
  });
  return { flow, tools, incoming: group(flow, 'to'), outgoing: group(flow, 'from'), toolsOf: group(tools, 'from'), toolIn: group(tools, 'to') };
}

const successorInvalid = (node: GraphNode, next: readonly GraphEdge[]): boolean => {
  if (node.kind === 'end') return next.length !== 0;
  if (node.kind !== 'condition') return next.length !== 1 || next[0]?.branch !== undefined;
  const branches = next.map((edge) => edge.branch);
  return next.length === 0 || next.length > 2 || branches.some((branch) => branch !== 'true' && branch !== 'false') || new Set(branches).size !== branches.length;
};

function validateAgentTools(node: GraphNode, byId: ReadonlyMap<string, GraphNode>, model: FlowModel, issues: GraphIssue[]): void {
  const attached = model.toolsOf.get(node.id) ?? [];
  if (attached.length === 0) return;
  if (attached.length > MAX_AGENT_TOOLS) issues.push(issue(`/nodes/${node.id}`, 'TOO_MANY_TOOLS'));
  const capabilities = attached.map((edge) => byId.get(edge.to)?.config['capability']);
  if (new Set(capabilities).size !== capabilities.length) issues.push(issue(`/nodes/${node.id}`, 'DUPLICATE_TOOL'));
  const limits = node.config['policy'];
  if (policy(limits) && (limits.toolRounds < 1 || limits.effects < 1)) issues.push(issue(`/nodes/${node.id}`, 'TOOL_POLICY_REQUIRED'));
}

function validateToolNode(node: GraphNode, model: FlowModel, issues: GraphIssue[]): boolean {
  const attached = model.toolIn.get(node.id) ?? [];
  if (attached.length === 0) return false;
  if (node.kind !== 'mcp' || attached.length > 1 || (model.incoming.get(node.id) ?? []).length > 0 || (model.outgoing.get(node.id) ?? []).length > 0) issues.push(issue(`/nodes/${node.id}`, 'INVALID_TOOL_EDGE'));
  return true;
}

export function effectiveCapabilities(config: Record<string, unknown>, toolCapabilities: readonly string[]): string[] {
  const authored = Array.isArray(config['allowedCapabilities']) ? config['allowedCapabilities'] as string[] : [];
  return [...new Set([...authored, ...toolCapabilities])];
}

function validateConditionNode(node: GraphNode, byId: ReadonlyMap<string, GraphNode>, triggerId: string | undefined, pins: readonly CapabilityPin[], prior: (source: string, target: string) => boolean, issues: GraphIssue[]): void {
  const source = node.config['source'] === 'input' ? (triggerId ? byId.get(triggerId) : undefined) : byId.get(String(node.config['source']));
  const shape = outputShape(source, pins);
  if (!schema(shape) || shape.properties[String(node.config['field'])]?.type !== typeof node.config['equals'] || !source || !prior(source.id, node.id)) issues.push(issue(`/nodes/${node.id}`, 'INVALID_MAPPING'));
}

function validateFlowNode(node: GraphNode, byId: ReadonlyMap<string, GraphNode>, model: FlowModel, pins: readonly CapabilityPin[], dominated: ReadonlyMap<string, ReadonlySet<string>>, triggerId: string | undefined, issues: GraphIssue[]): void {
  const next = model.outgoing.get(node.id) ?? []; const inbound = model.incoming.get(node.id) ?? []; const at = `/nodes/${node.id}`;
  const prior = (source: string, target: string): boolean => strictlyDominates(dominated, source, target);
  if (node.kind === 'trigger' && inbound.length > 0) issues.push(issue(at, 'TRIGGER_HAS_INPUT'));
  if (node.kind !== 'trigger' && inbound.length === 0) issues.push(issue(at, 'MISSING_INPUT'));
  if (successorInvalid(node, next)) issues.push(issue(at, 'INVALID_SUCCESSOR'));
  if (node.kind === 'agent') validateAgentTools(node, byId, model, issues);
  if (node.kind === 'mcp') {
    const pin = pinFor(pins, node);
    if (pin?.risk !== 'R1' && inbound.some((edge) => byId.get(edge.from)?.kind !== 'approval')) issues.push(issue(at, 'APPROVAL_REQUIRED'));
    let ancestor = immediateDominator(dominated, node.id);
    while (ancestor !== undefined && byId.get(ancestor)?.kind !== 'agent') ancestor = immediateDominator(dominated, ancestor);
    const agent = ancestor === undefined ? undefined : byId.get(ancestor);
    const toolCapabilities = agent ? (model.toolsOf.get(agent.id) ?? []).map((edge) => String(byId.get(edge.to)?.config['capability'])) : [];
    if (agent && !effectiveCapabilities(agent.config, toolCapabilities).includes(String(node.config['capability']))) issues.push(issue(at, 'UNGRANTED_CAPABILITY'));
    const args = node.config['arguments'];
    if (object(args) && Object.values(args).some((value) => { const source = typeof value === 'string' ? /^\$node\.([a-zA-Z0-9_-]+)\./u.exec(value)?.[1] : undefined; return source !== undefined && !prior(source, node.id); })) issues.push(issue(at, 'INVALID_MAPPING'));
  }
  if (node.kind === 'condition') validateConditionNode(node, byId, triggerId, pins, prior, issues);
  if (node.kind === 'approval' && next[0] && byId.get(next[0].to)?.kind !== 'mcp') issues.push(issue(at, 'APPROVAL_TARGET_REQUIRED'));
}

function validateCycles(triggerId: string, model: FlowModel, issues: GraphIssue[]): Set<string> {
  const seen = new Set<string>(); const active = new Set<string>();
  const walk = (id: string): void => {
    if (active.has(id)) { issues.push(issue(`/nodes/${id}`, 'CYCLE')); return; }
    if (seen.has(id)) return;
    active.add(id); seen.add(id);
    for (const edge of model.outgoing.get(id) ?? []) walk(edge.to);
    active.delete(id);
  };
  walk(triggerId);
  return seen;
}

function validateFlow(byId: ReadonlyMap<string, GraphNode>, model: FlowModel, pins: readonly CapabilityPin[], issues: GraphIssue[]): void {
  const triggers = [...byId.values()].filter((node) => node.kind === 'trigger'); const triggerId = triggers.length === 1 ? triggers[0]?.id : undefined;
  if (triggers.length !== 1) issues.push(issue('/nodes', 'SINGLE_TRIGGER_REQUIRED'));
  if (![...byId.values()].some((node) => node.kind === 'end')) issues.push(issue('/nodes', 'END_REQUIRED'));
  const dominated = triggerId === undefined ? new Map<string, ReadonlySet<string>>() : dominators(model.flow, triggerId);
  const toolNodes = new Set<string>();
  for (const node of byId.values()) {
    if (validateToolNode(node, model, issues)) { toolNodes.add(node.id); continue; }
    validateFlowNode(node, byId, model, pins, dominated, triggerId, issues);
  }
  const seen = triggerId === undefined ? new Set<string>() : validateCycles(triggerId, model, issues);
  for (const node of byId.values()) if (!seen.has(node.id) && !toolNodes.has(node.id)) issues.push(issue(`/nodes/${node.id}`, 'UNREACHABLE'));
}

export function validateGraph(value: unknown, pins: readonly CapabilityPin[] = []): GraphIssue[] {
  if (!object(value) || value['kind'] !== 'graph-v1' || !fields(value, ['kind', 'nodes', 'edges']) || !Array.isArray(value['nodes']) || !Array.isArray(value['edges']) || !plain(value)) return [issue('/', 'INVALID_GRAPH')];
  const nodes = value['nodes'] as unknown[]; const edges = value['edges'] as unknown[]; const issues: GraphIssue[] = [];
  if (nodes.length === 0 || nodes.length > 100 || edges.length > 200) issues.push(issue('/nodes', 'INVALID_SIZE'));
  const toolTargets = new Set(edges.flatMap((raw) => object(raw) && raw['role'] === 'tool' && typeof raw['to'] === 'string' ? [raw['to']] : []));
  const byId = validateNodes(nodes, pins, toolTargets, issues);
  const model = validateEdges(edges, byId, issues);
  validateFlow(byId, model, pins, issues);
  return issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
}

const compileNode = (node: GraphNode, graph: GraphDraft, toolTargets: ReadonlySet<string>, byId: ReadonlyMap<string, GraphNode>): CompiledNode => {
  if (toolTargets.has(node.id)) return { id: node.id, kind: 'mcp', config: { ...node.config, arguments: {} }, tool: true, next: null };
  const flow = graph.edges.filter((edge) => edge.from === node.id && isFlowEdge(edge));
  const tools = node.kind === 'agent' ? graph.edges.filter((edge) => edge.from === node.id && edge.role === 'tool').map((edge) => edge.to) : [];
  const config = tools.length ? { ...node.config, allowedCapabilities: effectiveCapabilities(node.config, tools.map((id) => String(byId.get(id)?.config['capability']))) } : node.config;
  const branch = (name: 'true' | 'false'): string | null => flow.find((edge) => edge.branch === name)?.to ?? null;
  return { id: node.id, kind: node.kind as NodeKind, config, ...(node.kind === 'agent' ? { instructions: node.instructions } : {}), ...(tools.length ? { tools } : {}), next: node.kind === 'end' ? null : node.kind === 'condition' ? { true: branch('true'), false: branch('false') } : flow[0]!.to };
};

export async function compileGraph(id: string, revision: number, graph: GraphDraft, pins: readonly CapabilityPin[]): Promise<WorkflowDefinition> {
  const issues = validateGraph(graph, pins); if (issues.length) throw Object.assign(new Error('INVALID_GRAPH'), { code: 'INVALID', issues });
  const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const toolTargets = new Set(graph.edges.filter((edge) => edge.role === 'tool').map((edge) => edge.to));
  const nodes = graph.nodes.map((node) => compileNode(node, graph, toolTargets, byId));
  const start = graph.nodes.find((node) => node.kind === 'trigger')!.id;
  const usedPins = graph.nodes.filter((node) => node.kind === 'mcp').map((node) => pinFor(pins, node)!);
  const definition = { id, revision, start, nodes, capabilityPins: usedPins };
  return { ...definition, digest: await digest(definition) };
}
