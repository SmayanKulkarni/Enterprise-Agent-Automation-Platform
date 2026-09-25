import { digest } from '../../contracts/src/index.js';

export type NodeKind = 'trigger' | 'memory' | 'agent' | 'condition' | 'approval' | 'mcp' | 'end';
export interface GraphNode { id: string; kind: string; title: string; detail: string; x: number; y: number; instructions: string; config: Record<string, unknown>; }
export interface GraphEdge { id: string; from: string; to: string; branch?: 'true' | 'false'; }
export interface GraphDraft { kind: 'graph-v1'; nodes: GraphNode[]; edges: GraphEdge[]; }
export interface GraphIssue { path: string; code: string; message: string; }
export interface CapabilityPin { nodeId: string; installationId: string; capability: string; manifestDigest: string; grantId: string; risk: 'R1' | 'R2' | 'R3'; inputSchema: JsonSchema; outputSchema: JsonSchema; }
export interface NodePolicy { milliseconds: number; attempts: number; tokens: number; cost: number; toolRounds: number; effects: number; }
export interface JsonSchema { type: 'object'; properties: Record<string, { type: 'string' | 'number' | 'boolean' | 'object' | 'array' }>; required: string[]; additionalProperties: false; }
export interface CompiledNode { id: string; kind: NodeKind; config: Record<string, unknown>; instructions?: string; next: string | { true: string; false: string } | null; }
export interface WorkflowDefinition { id: string; revision: number; digest: string; start: string; nodes: readonly CompiledNode[]; capabilityPins: readonly CapabilityPin[]; }

const kinds = new Set<NodeKind>(['trigger', 'memory', 'agent', 'condition', 'approval', 'mcp', 'end']);
const forbidden = /(?:token|secret|password|credential|api.?key|private.?key|authorization|connection.?string|cookie|bearer)/iu;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const plain = (value: unknown): boolean => value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || Array.isArray(value) && value.every(plain) || object(value) && Object.entries(value).every(([key, child]) => (key === 'tokens' || !forbidden.test(key)) && plain(child));
const fields = (value: Record<string, unknown>, names: readonly string[]): boolean => Object.keys(value).every((key) => names.includes(key));
export const validateSchema = (value: unknown): value is JsonSchema => object(value) && fields(value, ['type', 'properties', 'required', 'additionalProperties']) && value['type'] === 'object' && value['additionalProperties'] === false && object(value['properties']) && Object.values(value['properties']).every((property) => object(property) && fields(property, ['type']) && ['string', 'number', 'boolean', 'object', 'array'].includes(String(property['type']))) && Array.isArray(value['required']) && value['required'].every((key: unknown) => typeof key === 'string' && key in (value['properties'] as object));
const schema = validateSchema;
const proposalSchema = (value: JsonSchema): boolean => value.properties['memoryProposals'] === undefined || value.properties['memoryProposals']?.type === 'array' && !value.required.includes('memoryProposals');
const policy = (value: unknown): value is NodePolicy => object(value) && fields(value, ['milliseconds', 'attempts', 'tokens', 'cost', 'toolRounds', 'effects']) && Number.isSafeInteger(value['milliseconds']) && Number(value['milliseconds']) > 0 && Number(value['milliseconds']) <= 86400000 && Number.isSafeInteger(value['attempts']) && Number(value['attempts']) > 0 && Number(value['attempts']) <= 5 && Number.isSafeInteger(value['tokens']) && Number(value['tokens']) >= 0 && Number(value['tokens']) <= 100000 && typeof value['cost'] === 'number' && Number.isFinite(value['cost']) && value['cost'] >= 0 && value['cost'] <= 1000 && Number.isSafeInteger(value['toolRounds']) && Number(value['toolRounds']) >= 0 && Number(value['toolRounds']) <= 20 && Number.isSafeInteger(value['effects']) && Number(value['effects']) >= 0 && Number(value['effects']) <= 20;
const issue = (path: string, code: string): GraphIssue => ({ path, code, message: code.toLowerCase().replaceAll('_', ' ') });

export function validateValue(value: unknown, shape: JsonSchema): boolean {
  return object(value) && shape.required.every((key) => key in value) && Object.entries(value).every(([key, child]) => {
    const property = shape.properties[key];
    return property !== undefined && (property.type === 'object' ? object(child) && plain(child) : property.type === 'array' ? Array.isArray(child) && child.every(plain) : typeof child === property.type);
  });
}

export function validateGraph(value: unknown, pins: readonly CapabilityPin[] = []): GraphIssue[] {
  if (!object(value) || value['kind'] !== 'graph-v1' || !fields(value, ['kind', 'nodes', 'edges']) || !Array.isArray(value['nodes']) || !Array.isArray(value['edges']) || !plain(value)) return [issue('/', 'INVALID_GRAPH')];
  const nodes = value['nodes'] as unknown[]; const edges = value['edges'] as unknown[]; const issues: GraphIssue[] = [];
  if (nodes.length === 0 || nodes.length > 100 || edges.length > 200) issues.push(issue('/nodes', 'INVALID_SIZE'));
  const ids = new Set<string>(); const byId = new Map<string, GraphNode>();
  nodes.forEach((raw, index) => {
    const path = `/nodes/${index}`;
    if (!object(raw) || !fields(raw, ['id', 'kind', 'title', 'detail', 'x', 'y', 'instructions', 'config']) || typeof raw['id'] !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/u.test(raw['id']) || typeof raw['title'] !== 'string' || typeof raw['detail'] !== 'string' || typeof raw['instructions'] !== 'string' || !Number.isFinite(raw['x']) || !Number.isFinite(raw['y']) || !object(raw['config'])) { issues.push(issue(path, 'INVALID_NODE')); return; }
    const node = raw as unknown as GraphNode;
    if (ids.has(node.id)) issues.push(issue(`${path}/id`, 'DUPLICATE_ID'));
    ids.add(node.id); byId.set(node.id, node);
    if (!kinds.has(node.kind as NodeKind)) { issues.push(issue(`${path}/kind`, 'UNSUPPORTED_KIND')); return; }
    const config = node.config;
    if (node.kind === 'trigger' && !(fields(config, ['mode', 'inputSchema']) && ['manual', 'webhook'].includes(String(config['mode'])) && schema(config['inputSchema']))) issues.push(issue(`${path}/config`, 'INVALID_TRIGGER'));
    if (node.kind === 'memory' && !(fields(config, ['limit', 'maxChars', 'policy']) && Number.isSafeInteger(config['limit']) && Number(config['limit']) > 0 && Number(config['limit']) <= 20 && Number.isSafeInteger(config['maxChars']) && Number(config['maxChars']) > 0 && Number(config['maxChars']) <= 4000 && policy(config['policy']))) issues.push(issue(`${path}/config`, 'INVALID_MEMORY'));
    if (node.kind === 'agent' && !(fields(config, ['provider', 'model', 'fallback', 'promptVersion', 'responseSchema', 'policy', 'allowedCapabilities', 'openRouterOptIn']) && ['azure-openai', 'openrouter'].includes(String(config['provider'])) && typeof config['model'] === 'string' && config['model'].length > 0 && (config['fallback'] === undefined || typeof config['fallback'] === 'string') && typeof config['promptVersion'] === 'string' && config['promptVersion'].length > 0 && schema(config['responseSchema']) && proposalSchema(config['responseSchema']) && policy(config['policy']) && Array.isArray(config['allowedCapabilities']) && config['allowedCapabilities'].every((name: unknown) => typeof name === 'string') && (config['provider'] !== 'openrouter' || config['openRouterOptIn'] === true))) issues.push(issue(`${path}/config`, 'INVALID_AGENT'));
    if (node.kind === 'condition' && !(fields(config, ['source', 'field', 'equals']) && typeof config['source'] === 'string' && typeof config['field'] === 'string' && ['string', 'number', 'boolean'].includes(typeof config['equals']))) issues.push(issue(`${path}/config`, 'INVALID_CONDITION'));
    if (node.kind === 'approval' && !(fields(config, ['timeoutMs']) && Number.isSafeInteger(config['timeoutMs']) && Number(config['timeoutMs']) > 0 && Number(config['timeoutMs']) <= 86400000)) issues.push(issue(`${path}/config`, 'INVALID_APPROVAL'));
    if (node.kind === 'mcp') {
      const pin = pins.find((item) => item.nodeId === node.id && item.installationId === config['installationId'] && item.capability === config['capability'] && item.manifestDigest === config['manifestDigest'] && item.grantId === config['grantId']);
      const argumentsValue = config['arguments'];
      const mappingValid = pin && object(argumentsValue) && pin.inputSchema.required.every((key) => key in argumentsValue) && Object.entries(argumentsValue).every(([key, child]) => {
        const targetType = pin.inputSchema.properties[key]?.type;
        if (!targetType) return false;
        if (typeof child !== 'string' || !child.startsWith('$')) return typeof child === targetType;
        const mapping = /^\$(input|node\.([a-zA-Z0-9_-]+))\.([a-zA-Z0-9_-]+)$/u.exec(child);
        if (!mapping) return false;
        const source = mapping[1] === 'input' ? nodes.find((item) => object(item) && item['kind'] === 'trigger') : nodes.find((item) => object(item) && item['id'] === mapping[2]);
        if (!object(source)) return false;
        const config = source['config']; if (!object(config)) return false;
        const shape = source['kind'] === 'trigger' ? config['inputSchema'] : source['kind'] === 'agent' ? config['responseSchema'] : undefined;
        return schema(shape) && shape.properties[mapping[3]!]?.type === targetType;
      });
      if (pin && object(argumentsValue) && !mappingValid) {
        for (const name of pin.inputSchema.required) if (!(name in argumentsValue)) issues.push(issue(`${path}/config/arguments/${name}`, 'MISSING_ARGUMENT'));
        for (const [name, value] of Object.entries(argumentsValue)) {
          const expected = pin.inputSchema.properties[name]?.type;
          if (!expected || !(typeof value === 'string' && value.startsWith('$')) && typeof value !== expected) issues.push(issue(`${path}/config/arguments/${name}`, 'INVALID_MAPPING'));
        }
      }
      if (!(fields(config, ['installationId', 'capability', 'manifestDigest', 'grantId', 'target', 'arguments', 'policy']) && typeof config['target'] === 'string' && object(argumentsValue) && policy(config['policy']) && (config['policy'] as NodePolicy).effects >= 1 && pin && mappingValid)) issues.push(issue(`${path}/config`, 'UNGRANTED_CAPABILITY'));
    }
    if (node.kind === 'end' && !fields(config, [])) issues.push(issue(`${path}/config`, 'INVALID_END'));
  });
  const incoming = new Map<string, number>(); const parents = new Map<string, string>(); const outgoing = new Map<string, GraphEdge[]>();
  edges.forEach((raw, index) => {
    const path = `/edges/${index}`;
    if (!object(raw) || !fields(raw, ['id', 'from', 'to', 'branch']) || typeof raw['id'] !== 'string' || typeof raw['from'] !== 'string' || typeof raw['to'] !== 'string' || !byId.has(raw['from']) || !byId.has(raw['to']) || raw['from'] === raw['to']) { issues.push(issue(path, 'DANGLING_EDGE')); return; }
    const edge = raw as unknown as GraphEdge;
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1); parents.set(edge.to, edge.from); outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  });
  const prior = (source: string, target: string): boolean => { const visited = new Set<string>(); let cursor = parents.get(target); while (cursor && !visited.has(cursor)) { if (cursor === source) return true; visited.add(cursor); cursor = parents.get(cursor); } return false; };
  const triggers = [...byId.values()].filter((node) => node.kind === 'trigger');
  if (triggers.length !== 1) issues.push(issue('/nodes', 'SINGLE_TRIGGER_REQUIRED'));
  if (![...byId.values()].some((node) => node.kind === 'end')) issues.push(issue('/nodes', 'END_REQUIRED'));
  for (const node of byId.values()) {
    const next = outgoing.get(node.id) ?? [];
    if (node.kind === 'trigger' && incoming.has(node.id) || node.kind !== 'trigger' && incoming.get(node.id) !== 1) issues.push(issue(`/nodes/${node.id}`, 'JOIN_OR_MISSING_INPUT'));
    if (node.kind === 'end' ? next.length !== 0 : node.kind === 'condition' ? next.length !== 2 || new Set(next.map((edge) => edge.branch)).size !== 2 || !next.some((edge) => edge.branch === 'true') || !next.some((edge) => edge.branch === 'false') : next.length !== 1 || next[0]?.branch !== undefined) issues.push(issue(`/nodes/${node.id}`, 'INVALID_SUCCESSOR'));
    if (node.kind === 'mcp') {
      const pin = pins.find((item) => item.nodeId === node.id && item.installationId === node.config['installationId'] && item.capability === node.config['capability']);
      if (pin?.risk !== 'R1' && [...byId.values()].filter((candidate) => (outgoing.get(candidate.id) ?? []).some((edge) => edge.to === node.id)).some((candidate) => candidate.kind !== 'approval')) issues.push(issue(`/nodes/${node.id}`, 'APPROVAL_REQUIRED'));
      const visited = new Set<string>(); let ancestor = parents.get(node.id);
      while (ancestor && !visited.has(ancestor)) { visited.add(ancestor); const parent = byId.get(ancestor); if (parent?.kind === 'agent') { if (!Array.isArray(parent.config['allowedCapabilities']) || !parent.config['allowedCapabilities'].includes(node.config['capability'])) issues.push(issue(`/nodes/${node.id}`, 'UNGRANTED_CAPABILITY')); break; } ancestor = parents.get(ancestor); }
    }
    if (node.kind === 'condition') {
      const source = node.config['source'] === 'input' ? triggers[0] : byId.get(String(node.config['source']));
      const shape = source?.kind === 'trigger' ? source.config['inputSchema'] : source?.kind === 'agent' ? source.config['responseSchema'] : undefined;
      if (!schema(shape) || shape.properties[String(node.config['field'])]?.type !== typeof node.config['equals'] || source && !prior(source.id, node.id)) issues.push(issue(`/nodes/${node.id}`, 'INVALID_MAPPING'));
    }
    if (node.kind === 'mcp' && object(node.config['arguments']) && Object.values(node.config['arguments']).some((value) => { const source = typeof value === 'string' ? /^\$node\.([a-zA-Z0-9_-]+)\./u.exec(value)?.[1] : undefined; return source !== undefined && !prior(source, node.id); })) issues.push(issue(`/nodes/${node.id}`, 'INVALID_MAPPING'));
    if (node.kind === 'approval' && next[0] && byId.get(next[0].to)?.kind !== 'mcp') issues.push(issue(`/nodes/${node.id}`, 'APPROVAL_TARGET_REQUIRED'));
  }
  const seen = new Set<string>(); const active = new Set<string>();
  const walk = (id: string): void => { if (active.has(id)) { issues.push(issue(`/nodes/${id}`, 'CYCLE')); return; } if (seen.has(id)) return; active.add(id); seen.add(id); for (const edge of outgoing.get(id) ?? []) walk(edge.to); active.delete(id); };
  if (triggers[0]) walk(triggers[0].id);
  for (const node of byId.values()) if (!seen.has(node.id)) issues.push(issue(`/nodes/${node.id}`, 'UNREACHABLE'));
  return issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
}

export async function compileGraph(id: string, revision: number, graph: GraphDraft, pins: readonly CapabilityPin[]): Promise<WorkflowDefinition> {
  const issues = validateGraph(graph, pins); if (issues.length) throw Object.assign(new Error('INVALID_GRAPH'), { code: 'INVALID', issues });
  const nodes: CompiledNode[] = graph.nodes.map((node) => {
    const edges = graph.edges.filter((edge) => edge.from === node.id);
    return { id: node.id, kind: node.kind as NodeKind, config: node.config, ...(node.kind === 'agent' ? { instructions: node.instructions } : {}), next: node.kind === 'end' ? null : node.kind === 'condition' ? { true: edges.find((edge) => edge.branch === 'true')!.to, false: edges.find((edge) => edge.branch === 'false')!.to } : edges[0]!.to };
  });
  const start = graph.nodes.find((node) => node.kind === 'trigger')!.id;
  const usedPins = graph.nodes.filter((node) => node.kind === 'mcp').map((node) => pins.find((pin) => pin.nodeId === node.id && pin.installationId === node.config['installationId'] && pin.capability === node.config['capability'])!);
  const definition = { id, revision, start, nodes, capabilityPins: usedPins };
  return { ...definition, digest: await digest(definition) };
}
