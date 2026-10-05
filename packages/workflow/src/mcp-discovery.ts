export type DiscoveredFieldType = 'string' | 'number' | 'boolean' | 'object' | 'array';
export interface DiscoveredField { name: string; type: DiscoveredFieldType; required: boolean; }
export interface DiscoveredTool { name: string; description?: string; risk: 'R3'; fields: DiscoveredField[]; }
export interface McpDiscoveryPort { listTools(tenantId: string, installationId: string, endpoint: string, timeoutMs?: number): Promise<DiscoveredTool[]>; }

const MAX_TOOLS = 100;
const MAX_FIELDS = 50;
const MAX_NAME = 128;
const MAX_DESCRIPTION = 500;

const invalid = (): never => { throw Object.assign(new Error('INVALID'), { code: 'INVALID' }); };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const fieldType = (value: unknown): DiscoveredFieldType => value === 'number' || value === 'integer' ? 'number' : value === 'boolean' || value === 'object' || value === 'array' ? value : 'string';

const toolOf = (value: unknown): DiscoveredTool => {
  if (!object(value) || typeof value['name'] !== 'string' || value['name'].length === 0 || value['name'].length > MAX_NAME) return invalid();
  const schema = value['inputSchema'] ?? { type: 'object' };
  if (!object(schema)) return invalid();
  const properties = schema['properties'] ?? {};
  if (!object(properties) || Object.keys(properties).length > MAX_FIELDS) return invalid();
  const required = Array.isArray(schema['required']) ? schema['required'] : [];
  const fields = Object.entries(properties).map(([name, property]) => ({ name, type: fieldType(object(property) ? property['type'] : undefined), required: required.includes(name) }));
  return { name: value['name'], ...(typeof value['description'] === 'string' ? { description: value['description'].slice(0, MAX_DESCRIPTION) } : {}), risk: 'R3', fields };
};

export const parseToolList = (result: unknown): DiscoveredTool[] => {
  if (!object(result) || !Array.isArray(result['tools']) || result['tools'].length === 0 || result['tools'].length > MAX_TOOLS) return invalid();
  const tools = result['tools'].map(toolOf);
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) return invalid();
  return tools;
};
