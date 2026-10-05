export type Risk = 'R1' | 'R2' | 'R3';
export type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array';
export type ResultType = 'object' | 'array' | 'string';
export interface DiscoveredField { name: string; type: FieldType; required: boolean; }
export interface DiscoveredTool { name: string; description?: string; risk: Risk; fields: readonly DiscoveredField[]; }
export interface ToolChoice { include: boolean; risk: Risk; result: ResultType; fixed: string; }
type Fixed = Record<string, string | number | boolean>;

export const initialChoices = (tools: readonly DiscoveredTool[]): Record<string, ToolChoice> =>
  Object.fromEntries(tools.map((tool) => [tool.name, { include: true, risk: tool.risk, result: 'object' as const, fixed: '' }]));

const fixedValue = (field: DiscoveredField, raw: string): string | number | boolean => {
  if (raw === '') throw new Error(`${field.name} needs a value.`);
  if (field.type === 'string') return raw;
  if (field.type === 'number') { const value = Number(raw); if (!Number.isFinite(value)) throw new Error(`${field.name} must be a number.`); return value; }
  if (field.type === 'boolean') { if (raw !== 'true' && raw !== 'false') throw new Error(`${field.name} must be true or false.`); return raw === 'true'; }
  throw new Error(`${field.name} cannot be fixed.`);
};

export function parseFixed(text: string, fields: readonly DiscoveredField[]): Fixed {
  const fixed: Fixed = {};
  for (const line of text.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
    const at = line.indexOf('=');
    const name = at < 0 ? line : line.slice(0, at).trim();
    const field = fields.find((item) => item.name === name);
    if (at < 0 || field === undefined) throw new Error(`${name} is not an argument of this tool.`);
    if (name in fixed) throw new Error(`${name} is fixed twice.`);
    fixed[name] = fixedValue(field, line.slice(at + 1).trim());
  }
  return fixed;
}

export function buildInstallation(endpoint: string, tools: readonly DiscoveredTool[], choices: Readonly<Record<string, ToolChoice>>) {
  const capabilities = tools.flatMap((tool) => {
    const choice = choices[tool.name];
    if (choice === undefined || !choice.include) return [];
    const fixed = parseFixed(choice.fixed, tool.fields);
    const open = tool.fields.filter((field) => !(field.name in fixed));
    return [{
      name: tool.name, risk: choice.risk, ...(Object.keys(fixed).length ? { fixed } : {}),
      inputSchema: { type: 'object' as const, properties: Object.fromEntries(open.map((field) => [field.name, { type: field.type }])), required: open.filter((field) => field.required).map((field) => field.name), additionalProperties: false as const },
      outputSchema: { type: 'object' as const, properties: { result: { type: choice.result } }, required: ['result'], additionalProperties: false as const },
    }];
  });
  if (capabilities.length === 0) throw new Error('Include at least one tool.');
  return { route: 'public' as const, endpoint, health: 'healthy' as const, manifest: { version: '1', capabilities } };
}
