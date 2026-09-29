export const VISIBLE_LIMIT = 50;
export const OTHER_DEPLOYMENT = '__other__';

export type CatalogModel = { id: string; structuredOutput: boolean; tools: boolean; name?: string; contextLength?: number; promptPrice?: number; completionPrice?: number };
export type CatalogStatus = 'ready' | 'loading' | 'failed';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseCatalogModels(value: unknown): CatalogModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown): CatalogModel[] => record(item) && typeof item['id'] === 'string' && typeof item['structuredOutput'] === 'boolean' ? [{
    id: item['id'], structuredOutput: item['structuredOutput'], tools: item['tools'] === true,
    ...(typeof item['name'] === 'string' ? { name: item['name'] } : {}),
    ...(typeof item['contextLength'] === 'number' ? { contextLength: item['contextLength'] } : {}),
    ...(typeof item['promptPrice'] === 'number' ? { promptPrice: item['promptPrice'] } : {}),
    ...(typeof item['completionPrice'] === 'number' ? { completionPrice: item['completionPrice'] } : {}),
  }] : []);
}

const perMillion = (price: number | undefined): string | undefined => price === undefined ? undefined : `$${(price * 1_000_000).toFixed(2)}`;
export const context = (model: CatalogModel): string | undefined => model.contextLength ? `${model.contextLength.toLocaleString()} token context` : undefined;
export const pricing = (model: CatalogModel): string | undefined => { const input = perMillion(model.promptPrice); const output = perMillion(model.completionPrice); return input && output ? `${input} in / ${output} out per 1M tokens` : undefined; };

export function describeModel(model: CatalogModel | undefined): string | undefined {
  if (!model) return undefined;
  return [model.name, context(model), pricing(model), model.structuredOutput ? 'structured output' : undefined, model.tools ? 'tool calling' : undefined].filter(Boolean).join(' · ') || undefined;
}

export function filterModels(models: readonly CatalogModel[], query: string | undefined): CatalogModel[] {
  const tokens = (query ?? '').trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return [...models];
  const haystack = (model: CatalogModel) => `${model.id} ${model.name ?? ''}`.toLowerCase();
  const matches = models.filter((model) => tokens.every((token) => haystack(model).includes(token)));
  const whole = (query ?? '').trim().toLowerCase(); const first = tokens[0] ?? '';
  return [...matches.filter((model) => model.id.toLowerCase() === whole), ...matches.filter((model) => model.id.toLowerCase() !== whole && model.id.toLowerCase().startsWith(first)), ...matches.filter((model) => model.id.toLowerCase() !== whole && !model.id.toLowerCase().startsWith(first))];
}

export function modelProblem(selected: CatalogModel | undefined, value: string, catalogSize: number, requireStructured: boolean, requireTools: boolean, providerLabel: string): string | undefined {
  if (value && catalogSize > 0 && !selected) return `Not in the ${providerLabel} catalog.`;
  if (selected && requireStructured && !selected.structuredOutput) return 'This model does not support structured output.';
  if (selected && requireTools && !selected.tools) return 'This model does not support tool calling, which this Agent needs for its tools.';
  return undefined;
}

