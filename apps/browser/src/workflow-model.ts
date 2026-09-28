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

export interface WorkflowEdge { id: string; from: string; to: string; branch?: 'true' | 'false'; }

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
  { id: 'trigger', kind: 'trigger', title: 'New support request', detail: 'Webhook intake', x: 90, y: 300, instructions: 'Accept a validated support request from the intake webhook.' },
  { id: 'triage', kind: 'agent', title: 'Triage request', detail: 'Bounded agent', x: 370, y: 150, instructions: 'Classify the request, identify the account, and determine whether a customer-facing action is allowed.' },
  { id: 'context', kind: 'retriever', title: 'Find account context', detail: 'Knowledge search', x: 370, y: 450, instructions: 'Retrieve account context and cited policy documents for the request.' },
  { id: 'plan', kind: 'agent', title: 'Plan resolution', detail: 'Bounded agent', x: 680, y: 300, instructions: 'Propose the safest supported resolution. Request approval before any account change above the policy threshold.' },
  { id: 'approval', kind: 'approval', title: 'Approve account change', detail: 'Human checkpoint', x: 960, y: 300, instructions: 'Wait for an authorised approver when the planned action changes an account.' },
  { id: 'action', kind: 'mcp', title: 'Apply account action', detail: 'Governed tool call', x: 1240, y: 300, instructions: 'Execute the approved account action through the Billing actions MCP connection.' },
];

export const initialEdges: WorkflowEdge[] = [
  { id: 'trigger-triage', from: 'trigger', to: 'triage' },
  { id: 'trigger-context', from: 'trigger', to: 'context' },
  { id: 'triage-plan', from: 'triage', to: 'plan' },
  { id: 'context-plan', from: 'context', to: 'plan' },
  { id: 'plan-approval', from: 'plan', to: 'approval' },
  { id: 'approval-action', from: 'approval', to: 'action' },
];

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

export function connect(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], from: string, to: string, branch?: 'true' | 'false'): WorkflowEdge[] {
  if (from === to || !nodes.some((node) => node.id === from) || !nodes.some((node) => node.id === to) || edges.some((edge) => edge.from === from && (edge.to === to || branch !== undefined && edge.branch === branch))) return [...edges];
  return [...edges, { id: `${from}-${to}`, from, to, ...(branch ? { branch } : {}) }];
}

export function conditionSources(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], conditionId: string): readonly WorkflowNode[] {
  const preceding = new Set<string>(); const visit = (id: string): void => { for (const edge of edges.filter((item) => item.to === id)) if (!preceding.has(edge.from)) { preceding.add(edge.from); visit(edge.from); } };
  visit(conditionId);
  return nodes.filter((node) => preceding.has(node.id) && (node.kind === 'trigger' || node.kind === 'agent'));
}

export function conditionFields(node: WorkflowNode): readonly [string, 'string' | 'number' | 'boolean'][] {
  const schema = node.kind === 'trigger' ? node.config?.['inputSchema'] : node.config?.['responseSchema'];
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return [];
  const properties = (schema as Record<string, unknown>)['properties'];
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) return [];
  return Object.entries(properties).flatMap(([name, value]) => value !== null && typeof value === 'object' && !Array.isArray(value) && ['string', 'number', 'boolean'].includes(String((value as Record<string, unknown>)['type'])) ? [[name, (value as Record<string, unknown>)['type'] as 'string' | 'number' | 'boolean']] : []);
}

export function mappingFields(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], targetId: string, type: TriggerFieldType): readonly [string, string][] {
  const preceding = new Set<string>();
  const visit = (id: string): void => { for (const edge of edges.filter((item) => item.to === id)) if (!preceding.has(edge.from)) { preceding.add(edge.from); visit(edge.from); } };
  visit(targetId);
  return nodes.flatMap((node) => {
    if (!preceding.has(node.id) || node.kind !== 'trigger' && node.kind !== 'agent') return [];
    const schema = node.kind === 'trigger' ? node.config?.['inputSchema'] : node.config?.['responseSchema'];
    if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return [];
    const properties = (schema as Record<string, unknown>)['properties'];
    if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) return [];
    return Object.entries(properties).flatMap(([name, field]) => field !== null && typeof field === 'object' && !Array.isArray(field) && (field as Record<string, unknown>)['type'] === type ? [[node.kind === 'trigger' ? `$input.${name}` : `$node.${node.id}.${name}`, `${node.title} · ${name}`] as [string, string]] : []);
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
