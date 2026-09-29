import { dominators, immediateDominator, isFlowEdge, reaches, strictlyDominates } from '../../../packages/workflow/src/flow.js';

export type WorkflowNodeKind = 'trigger' | 'agent' | 'condition' | 'approval' | 'skill' | 'memory' | 'retriever' | 'mcp' | 'http' | 'webhook' | 'end';

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  title: string;
  detail: string;
  x: number;
  y: number;
  instructions: string;
  config?: Record<string, unknown>;
}

export interface WorkflowEdge { id: string; from: string; to: string; branch?: 'true' | 'false'; role?: 'tool'; }

export const MAX_AGENT_TOOLS = 16;
const DEFAULT_TOOL_ROUNDS = 3;

export const templates: Record<WorkflowNodeKind, Pick<WorkflowNode, 'title' | 'detail' | 'instructions'>> = {
  trigger: { title: 'New request', detail: 'Starts a run', instructions: 'Accept an event and pass its validated fields to the workflow.' },
  agent: { title: 'Reason about request', detail: 'Bounded agent', instructions: 'Use the available context to produce a safe next action. Escalate uncertain or policy-sensitive work.' },
  condition: { title: 'Check policy', detail: 'Route by rule', instructions: 'Evaluate the declared policy and route to the appropriate branch.' },
  approval: { title: 'Request approval', detail: 'Human checkpoint', instructions: 'Pause the run until an authorised reviewer approves or rejects the proposed action.' },
  skill: { title: 'Use skill', detail: 'Reusable guidance', instructions: 'Apply the attached, versioned skill to the current work item.' },
  memory: { title: 'Read memory', detail: 'Scoped context', instructions: 'Retrieve only the permitted memory scope for this case.' },
  retriever: { title: 'Retrieve evidence', detail: 'Knowledge search', instructions: 'Find relevant, cited knowledge for the current request.' },
  mcp: { title: 'Call MCP tool', detail: 'Governed tool call', instructions: 'Call the selected MCP tool with validated inputs and preserve the resulting evidence.' },
  http: { title: 'HTTP request', detail: 'External request', instructions: 'Send a validated request through the configured connection.' },
  webhook: { title: 'Send webhook', detail: 'Notify external system', instructions: 'Deliver the selected result to the configured webhook endpoint.' },
  end: { title: 'End', detail: 'Complete run', instructions: '' },
};

export const starterNodes: WorkflowNode[] = [
  { id: 'trigger', kind: 'trigger', title: 'Manual start', detail: 'Validated input', x: 160, y: 300, instructions: '', config: { mode: 'manual', inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false } } },
  { id: 'agent', kind: 'agent', title: 'Classify request', detail: 'Bounded model', x: 510, y: 300, instructions: 'Return a concise result.', config: { provider: 'azure-openai', model: 'gpt-4.1', promptVersion: '1', responseSchema: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'], additionalProperties: false }, policy: { milliseconds: 30000, attempts: 1, tokens: 1000, cost: 1, toolRounds: 0, effects: 0 }, allowedCapabilities: [] } },
  { id: 'end', kind: 'end', title: 'End', detail: 'Complete run', x: 860, y: 300, instructions: '', config: {} },
];
export const starterEdges: WorkflowEdge[] = [{ id: 'trigger-agent', from: 'trigger', to: 'agent' }, { id: 'agent-end', from: 'agent', to: 'end' }];

export const initialNodes: WorkflowNode[] = [
  { id: 'trigger', kind: 'trigger', title: 'New support request', detail: 'Webhook intake', x: 100, y: 300, instructions: 'Accept a validated support request from the intake webhook.' },
  { id: 'context', kind: 'retriever', title: 'Find account context', detail: 'Knowledge search', x: 380, y: 300, instructions: 'Retrieve account context and cited policy documents for the request.' },
  { id: 'triage', kind: 'agent', title: 'Triage request', detail: 'Bounded agent', x: 660, y: 300, instructions: 'Classify the request, identify the account, and determine whether a customer-facing action is allowed.' },
  { id: 'plan', kind: 'agent', title: 'Plan resolution', detail: 'Bounded agent', x: 940, y: 300, instructions: 'Propose the safest supported resolution. Request approval before any account change above the policy threshold.' },
  { id: 'approval', kind: 'approval', title: 'Approve account change', detail: 'Human checkpoint', x: 1220, y: 300, instructions: 'Wait for an authorised approver when the planned action changes an account.' },
  { id: 'action', kind: 'mcp', title: 'Apply account action', detail: 'Governed tool call', x: 1500, y: 300, instructions: 'Execute the approved account action through the Billing actions MCP connection.' },
];

export const initialEdges: WorkflowEdge[] = [
  { id: 'trigger-context', from: 'trigger', to: 'context' },
  { id: 'context-triage', from: 'context', to: 'triage' },
  { id: 'triage-plan', from: 'triage', to: 'plan' },
  { id: 'plan-approval', from: 'plan', to: 'approval' },
  { id: 'approval-action', from: 'approval', to: 'action' },
];

export function freeSequence(nodes: readonly WorkflowNode[], kind: WorkflowNodeKind, from: number): number {
  let index = from;
  while (nodes.some((node) => node.id === `${kind}-${String(index)}`)) index += 1;
  return index;
}

export function createNode(kind: WorkflowNodeKind, x: number, y: number, sequence: number): WorkflowNode {
  const template = templates[kind];
  const defaults: Partial<Record<WorkflowNodeKind, Record<string, unknown>>> = {
    trigger: starterNodes[0]!.config!, agent: starterNodes[1]!.config!, end: {},
    memory: { limit: 3, maxChars: 2000, policy: { milliseconds: 30000, attempts: 1, tokens: 0, cost: 0, toolRounds: 0, effects: 0 } },
    condition: { source: 'agent', field: 'result', equals: 'approve' }, approval: { timeoutMs: 3600000 },
    mcp: { installationId: '', capability: '', manifestDigest: '', grantId: '', target: '', arguments: {}, policy: { milliseconds: 30000, attempts: 1, tokens: 0, cost: 0, toolRounds: 0, effects: 1 } },
  };
  return { id: `${kind}-${sequence}`, kind, ...template, x, y, config: defaults[kind] ?? {} };
}

type Branch = 'true' | 'false' | undefined;
type Fields = readonly [string, 'string' | 'number' | 'boolean'][];
export type OutputSchemas = (node: WorkflowNode) => unknown;

const flowOf = (edges: readonly WorkflowEdge[]): WorkflowEdge[] => edges.filter(isFlowEdge);
const linked = (edges: readonly WorkflowEdge[], id: string): boolean => edges.some((edge) => edge.from === id || edge.to === id);
const toolEdgesOf = (edges: readonly WorkflowEdge[], agentId: string): WorkflowEdge[] => edges.filter((edge) => edge.role === 'tool' && edge.from === agentId);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export const isToolNode = (edges: readonly WorkflowEdge[], id: string): boolean => edges.some((edge) => edge.role === 'tool' && edge.to === id);
export const toolsOf = (nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], agentId: string): WorkflowNode[] => toolEdgesOf(edges, agentId).flatMap((edge) => nodes.filter((node) => node.id === edge.to));
export const toolOwner = (nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], toolId: string): WorkflowNode | undefined => nodes.find((node) => edges.some((edge) => edge.role === 'tool' && edge.to === toolId && edge.from === node.id));

function edgeId(edges: readonly WorkflowEdge[], from: string, to: string, branch: Branch, role?: 'tool'): string {
  const base = `${from}-${to}${branch ? `-${branch}` : ''}${role ? '-tool' : ''}`;
  let candidate = base;
  for (let index = 2; edges.some((edge) => edge.id === candidate); index += 1) candidate = `${base}-${String(index)}`;
  return candidate;
}

function linkError(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], from: string, to: string, branch: Branch): string | undefined {
  const source = nodes.find((node) => node.id === from);
  const target = nodes.find((node) => node.id === to);
  if (!source || !target) return 'Choose two existing steps.';
  if (from === to) return "A step can't connect to itself.";
  if (source.kind === 'end') return 'End is the last step and has no output.';
  if (target.kind === 'trigger') return 'The Trigger starts the workflow and has no input.';
  if (isToolNode(edges, from) || isToolNode(edges, to)) return 'This step is attached to an Agent as a tool. Remove that tool connection to use it as a step in the flow.';
  if (source.kind === 'condition' && !branch) return 'Use the True or False output of a Condition.';
  if (source.kind !== 'condition' && branch) return 'Only a Condition has True and False outputs.';
  if (flowOf(edges).some((edge) => edge.from === from && edge.to === to && edge.branch === branch)) return 'Those steps are already connected.';
  if (source.kind === 'approval' && target.kind !== 'mcp') return 'Approval can only lead to an MCP tool.';
  if (reaches(edges, to, from)) return 'That connection would create a loop.';
  return undefined;
}

function splice(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], from: string, to: string, branch: Branch): WorkflowEdge[] | string {
  const flow = flowOf(edges);
  const inbound = flow.filter((edge) => edge.to === to);
  const outbound = flow.find((edge) => edge.from === from && edge.branch === branch);
  const kind = (id: string) => nodes.find((node) => node.id === id)?.kind;
  const link = (list: readonly WorkflowEdge[], a: string, b: string, edgeBranch?: 'true' | 'false'): WorkflowEdge => ({ id: edgeId(list, a, b, edgeBranch), from: a, to: b, ...(edgeBranch ? { branch: edgeBranch } : {}) });
  if (!outbound) {
    const only = inbound.length === 1 ? inbound[0] : undefined;
    if (only && !linked(edges, from) && kind(from) !== 'trigger' && kind(from) !== 'condition') {
      const rest = edges.filter((edge) => edge !== only);
      const first = linkError(nodes, rest, only.from, from, only.branch);
      if (first) return first;
      const head = link(rest, only.from, from, only.branch);
      return [...rest, head, link([...rest, head], from, to)];
    }
    return [...edges, link(edges, from, to, branch)];
  }
  if (!linked(edges, to) && kind(to) !== 'end' && kind(to) !== 'condition') {
    const rest = edges.filter((edge) => edge !== outbound);
    const last = linkError(nodes, rest, to, outbound.to, undefined);
    if (last) return last;
    const head = link(rest, from, to, branch);
    return [...rest, head, link([...rest, head], to, outbound.to)];
  }
  return branch ? 'That branch already leads to a step. Remove its connection, or connect an unlinked step to insert it.' : 'That output is already connected. Remove its connection, or connect an unlinked step to insert it.';
}

export function connectionError(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], from: string, to: string, branch?: 'true' | 'false'): string | undefined {
  const error = linkError(nodes, edges, from, to, branch);
  if (error) return error;
  const result = splice(nodes, edges, from, to, branch);
  return typeof result === 'string' ? result : undefined;
}

export function connect(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], from: string, to: string, branch?: 'true' | 'false'): WorkflowEdge[] {
  if (linkError(nodes, edges, from, to, branch)) return [...edges];
  const result = splice(nodes, edges, from, to, branch);
  return typeof result === 'string' ? [...edges] : result;
}

const TOOL_KINDS: readonly WorkflowNodeKind[] = ['mcp', 'memory'];
export const isToolCapable = (node: WorkflowNode): boolean => TOOL_KINDS.includes(node.kind);

export function toolError(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], agentId: string, toolId: string): string | undefined {
  const agent = nodes.find((node) => node.id === agentId);
  const tool = nodes.find((node) => node.id === toolId);
  if (!agent || !tool) return 'Choose an Agent and a tool.';
  if (agent.kind !== 'agent') return 'Only an Agent can use tools. Attach the MCP or Memory step to an Agent.';
  if (!isToolCapable(tool)) return 'Only an MCP or Memory step can be attached as a tool.';
  if (edges.some((edge) => edge.role === 'tool' && edge.from === agentId && edge.to === toolId)) return 'That step is already a tool of this Agent.';
  if (isToolNode(edges, toolId)) return 'That step is already a tool of another Agent. Add another step for this Agent.';
  if (linked(flowOf(edges), toolId)) return 'That step is already in the flow. Remove its flow connections to use it as a tool.';
  if (tool.kind === 'memory' && toolsOf(nodes, edges, agentId).some((item) => item.kind === 'memory')) return 'An Agent can have only one Memory tool.';
  if (toolEdgesOf(edges, agentId).length >= MAX_AGENT_TOOLS) return `An Agent can have at most ${String(MAX_AGENT_TOOLS)} tools.`;
  return undefined;
}

export function attachTool(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], agentId: string, toolId: string): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  if (toolError(nodes, edges, agentId, toolId)) return { nodes: [...nodes], edges: [...edges] };
  const bump = (config: Record<string, unknown>): Record<string, unknown> => {
    const policy = record(config['policy']) ? config['policy'] : {};
    const rounds = Number(policy['toolRounds']); const effects = Number(policy['effects']);
    return { ...config, policy: { ...policy, toolRounds: rounds >= 1 ? rounds : DEFAULT_TOOL_ROUNDS, effects: effects >= 1 ? effects : DEFAULT_TOOL_ROUNDS } };
  };
  return {
    nodes: nodes.map((node) => node.id === agentId ? { ...node, config: bump(node.config ?? {}) } : node.id === toolId && node.kind === 'mcp' ? { ...node, config: { ...node.config, arguments: {} } } : node),
    edges: [...edges, { id: edgeId(edges, agentId, toolId, undefined, 'tool'), from: agentId, to: toolId, role: 'tool' }],
  };
}

function outputProperties(node: WorkflowNode, outputs: OutputSchemas | undefined): Record<string, unknown> {
  const schema = node.kind === 'trigger' ? node.config?.['inputSchema'] : node.kind === 'agent' ? node.config?.['responseSchema'] : node.kind === 'mcp' ? outputs?.(node) : undefined;
  return record(schema) && record(schema['properties']) ? schema['properties'] : {};
}

function precedingSources(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], targetId: string): WorkflowNode[] {
  const trigger = nodes.find((node) => node.kind === 'trigger');
  if (!trigger) return [];
  const dominated = dominators(edges, trigger.id);
  return nodes.filter((node) => (node.kind === 'trigger' || node.kind === 'agent' || node.kind === 'mcp') && !isToolNode(edges, node.id) && (node.id === trigger.id || strictlyDominates(dominated, node.id, targetId)));
}

export function conditionSources(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], conditionId: string, outputs?: OutputSchemas): readonly WorkflowNode[] {
  return precedingSources(nodes, edges, conditionId).filter((node) => conditionFields(node, outputs).length > 0 || node.kind !== 'mcp');
}

export function conditionFields(node: WorkflowNode, outputs?: OutputSchemas): Fields {
  return Object.entries(outputProperties(node, outputs)).flatMap(([name, value]) => record(value) && ['string', 'number', 'boolean'].includes(String(value['type'])) ? [[name, value['type'] as 'string' | 'number' | 'boolean'] as const] : []);
}

export function mappingFields(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], targetId: string, type: TriggerFieldType, outputs?: OutputSchemas): readonly [string, string][] {
  return precedingSources(nodes, edges, targetId).flatMap((node) => Object.entries(outputProperties(node, outputs)).flatMap(([name, field]) => record(field) && field['type'] === type ? [[node.kind === 'trigger' ? `$input.${name}` : `$node.${node.id}.${name}`, `${node.title} · ${name}`] as [string, string]] : []));
}

export function capabilityOutputSchema(installations: readonly Record<string, unknown>[], node: WorkflowNode): unknown {
  const installationId = node.config?.['installationId']; const wanted = typeof installationId === 'string' ? installationId.toLowerCase() : '';
  const manifest = installations.find((item) => String(item['id']).toLowerCase() === wanted)?.['manifest'];
  const capabilities = record(manifest) && Array.isArray(manifest['capabilities']) ? manifest['capabilities'] : [];
  const match: unknown = capabilities.find((item: unknown) => record(item) && item['name'] === node.config?.['capability']);
  return record(match) ? match['outputSchema'] : undefined;
}

export function syncChainGrants(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[]): WorkflowNode[] {
  const trigger = nodes.find((node) => node.kind === 'trigger');
  if (!trigger) return [...nodes];
  const dominated = dominators(edges, trigger.id);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const grants = new Map<string, Set<string>>();
  for (const node of nodes) {
    const capability = node.config?.['capability'];
    if (node.kind !== 'mcp' || isToolNode(edges, node.id) || typeof capability !== 'string' || capability === '' || !dominated.has(node.id)) continue;
    let ancestor = immediateDominator(dominated, node.id);
    while (ancestor !== undefined && byId.get(ancestor)?.kind !== 'agent') ancestor = immediateDominator(dominated, ancestor);
    if (ancestor !== undefined) grants.set(ancestor, new Set([...(grants.get(ancestor) ?? []), capability]));
  }
  return nodes.map((node) => {
    const needed = grants.get(node.id);
    if (!needed) return node;
    const current = Array.isArray(node.config?.['allowedCapabilities']) ? (node.config['allowedCapabilities'] as unknown[]).filter((item): item is string => typeof item === 'string') : [];
    const missing = [...needed].filter((item) => !current.includes(item));
    return missing.length === 0 ? node : { ...node, config: { ...node.config, allowedCapabilities: [...current, ...missing] } };
  });
}

export function disconnect(edges: readonly WorkflowEdge[], edgeId: string): WorkflowEdge[] { return edges.filter((edge) => edge.id !== edgeId); }

export function issueNode(nodes: readonly WorkflowNode[], path: string): WorkflowNode | undefined {
  const segment = /^\/nodes\/([^/]+)/.exec(path)?.[1];
  if (segment === undefined) return undefined;
  return nodes.find((node) => node.id === segment) ?? (/^\d+$/.test(segment) ? nodes[Number(segment)] : undefined);
}

export function updateIntegerConfig(config: Record<string, unknown>, key: 'limit' | 'maxChars', value: string, minimum: number, maximum: number): { config?: Record<string, unknown>; error?: string } {
  const parsed = Number(value);
  if (value.trim() === '' || !Number.isFinite(parsed) || !Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return { error: `Enter a whole number from ${minimum} to ${maximum}.` };
  return { config: { ...config, [key]: parsed } };
}

export type TriggerFieldType = 'string' | 'number' | 'boolean' | 'object' | 'array';
export interface TriggerSchema { type: 'object'; properties: Record<string, { type: TriggerFieldType }>; required: string[]; additionalProperties: false; }

export function schemaFieldNameError(schema: TriggerSchema, name: string, previousName?: string): string | undefined {
  const normalized = name.trim();
  if (!normalized) return 'Enter a field name.';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) return 'Use letters, numbers, and underscores; start with a letter.';
  if (normalized !== previousName && normalized in schema.properties) return `${normalized} already exists.`;
  return undefined;
}

export function setSchemaField(schema: TriggerSchema, name: string, type: TriggerFieldType, required: boolean, previousName?: string): TriggerSchema {
  const normalized = name.trim();
  const properties = Object.fromEntries(Object.entries(schema.properties).filter(([key]) => key !== previousName || previousName === normalized));
  if (normalized) properties[normalized] = { type };
  const requiredFields = schema.required.filter((field) => field !== previousName && field !== normalized);
  return { ...schema, properties, required: required && normalized ? [...requiredFields, normalized] : requiredFields };
}

export function removeSchemaField(schema: TriggerSchema, name: string): TriggerSchema {
  const properties = Object.fromEntries(Object.entries(schema.properties).filter(([key]) => key !== name));
  return { ...schema, properties, required: schema.required.filter((field) => field !== name) };
}

export function parseTriggerInput(schema: TriggerSchema, values: Record<string, unknown>): { input?: Record<string, unknown>; errors?: Record<string, string> } {
  const input: Record<string, unknown> = {}; const errors: Record<string, string> = {};
  for (const [name, property] of Object.entries(schema.properties)) {
    const value = values[name]; const empty = value === '' || value === undefined;
    if (empty && schema.required.includes(name)) { errors[name] = 'Required.'; continue; }
    if (empty) continue;
    if (property.type === 'number') { const parsed = Number(value); if (!Number.isFinite(parsed)) { errors[name] = 'Enter a number.'; continue; } input[name] = parsed; continue; }
    if (property.type === 'boolean') { if (typeof value !== 'boolean') { errors[name] = 'Choose true or false.'; continue; } input[name] = value; continue; }
    if (property.type === 'object') { if (value === null || typeof value !== 'object' || Array.isArray(value)) { errors[name] = 'Add at least one named value.'; continue; } input[name] = value; continue; }
    if (property.type === 'array') { if (!Array.isArray(value)) { errors[name] = 'Add one or more values.'; continue; } input[name] = value; continue; }
    if (typeof value !== 'string') { errors[name] = 'Enter text.'; continue; } input[name] = value;
  }
  return Object.keys(errors).length ? { errors } : { input };
}

export function filterLibrary<T extends { title: string; items: readonly { kind: WorkflowNodeKind; label: string }[] }>(groups: readonly T[], query: string, help: Partial<Record<WorkflowNodeKind, string>>): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...groups];
  return groups.flatMap((group) => { const items = group.items.filter((item) => [item.label, item.kind, help[item.kind] ?? ''].some((text) => text.toLowerCase().includes(needle))); return items.length ? [{ ...group, items }] : []; });
}

export function localDateTime(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return '';
  const part = (number: number) => String(number).padStart(2, '0');
  return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}T${part(value.getHours())}:${part(value.getMinutes())}`;
}

export function expiryInstant(value: string, currentExpiry: string, now = Date.now()): { iso?: string; error?: string } {
  if (!value.trim()) return { error: 'Enter an expiry date and time.' };
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(value);
  if (!parts) return { error: 'Enter a valid expiry date and time.' };
  const [, year, month, day, hour, minute] = parts;
  const instant = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (instant.getFullYear() !== Number(year) || instant.getMonth() !== Number(month) - 1 || instant.getDate() !== Number(day) || instant.getHours() !== Number(hour) || instant.getMinutes() !== Number(minute)) return { error: 'Enter a valid expiry date and time.' };
  const current = Date.parse(currentExpiry);
  if (Number.isNaN(current)) return { error: 'The current expiry is unavailable. Refresh and try again.' };
  if (instant.getTime() > current) return { error: 'Expiry can only be shortened.' };
  if (instant.getTime() > now + 90 * 86400000) return { error: 'Expiry is beyond the allowed horizon.' };
  return { iso: instant.toISOString() };
}

export function memoryProposalsEnabled(config: Record<string, unknown>): boolean {
  const schema = config['responseSchema'];
  return schema !== null && typeof schema === 'object' && !Array.isArray(schema) && (schema as Record<string, unknown>)['properties'] !== null && typeof (schema as Record<string, unknown>)['properties'] === 'object' && !Array.isArray((schema as Record<string, unknown>)['properties']) && 'memoryProposals' in ((schema as Record<string, unknown>)['properties'] as Record<string, unknown>);
}

export function setMemoryProposals(config: Record<string, unknown>, enabled: boolean): Record<string, unknown> {
  const schema = config['responseSchema'] as Record<string, unknown>;
  const properties = schema['properties'] as Record<string, unknown>;
  const required = Array.isArray(schema['required']) ? schema['required'].filter((field): field is string => typeof field === 'string' && field !== 'memoryProposals') : [];
  const nextProperties = { ...properties };
  if (enabled) nextProperties['memoryProposals'] = { type: 'array' };
  else delete nextProperties['memoryProposals'];
  return { ...config, responseSchema: { ...schema, properties: nextProperties, required } };
}
