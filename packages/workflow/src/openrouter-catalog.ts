export interface OpenRouterModel { id: string; structuredOutput: boolean; tools: boolean; name?: string; contextLength?: number; promptPrice?: number; completionPrice?: number; }
export interface OpenRouterCatalog { chat(): Promise<readonly OpenRouterModel[]>; embedding(): Promise<readonly OpenRouterModel[]>; }

const BASE = 'https://openrouter.ai/api/v1';
const TTL_MILLISECONDS = 10 * 60 * 1000;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const price = (value: unknown): number | undefined => { const parsed = Number(value); return typeof value === 'string' && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined; };

export function parseCatalog(payload: unknown, textOutputOnly: boolean): readonly OpenRouterModel[] {
  if (!object(payload) || !Array.isArray(payload['data'])) throw new Error('INVALID_CATALOG');
  return payload['data'].flatMap((raw: unknown): OpenRouterModel[] => {
    if (!object(raw) || typeof raw['id'] !== 'string' || !raw['id'].includes('/')) return [];
    const output = object(raw['architecture']) && Array.isArray(raw['architecture']['output_modalities']) ? raw['architecture']['output_modalities'] : undefined;
    if (textOutputOnly && output && !output.includes('text')) return [];
    const parameters = Array.isArray(raw['supported_parameters']) ? raw['supported_parameters'] : [];
    const pricing = object(raw['pricing']) ? raw['pricing'] : {};
    return [{
      id: raw['id'], structuredOutput: parameters.includes('structured_outputs'), tools: parameters.includes('tools'),
      ...(typeof raw['name'] === 'string' ? { name: raw['name'] } : {}),
      ...(typeof raw['context_length'] === 'number' ? { contextLength: raw['context_length'] } : {}),
      ...(price(pricing['prompt']) !== undefined ? { promptPrice: price(pricing['prompt']) as number } : {}),
      ...(price(pricing['completion']) !== undefined ? { completionPrice: price(pricing['completion']) as number } : {}),
    }];
  }).sort((left, right) => left.id.localeCompare(right.id));
}

export function openRouterCatalog(fetcher: typeof fetch = fetch, now: () => number = Date.now): OpenRouterCatalog {
  const cache = new Map<string, { at: number; models: readonly OpenRouterModel[] }>();
  const load = async (path: string, textOutputOnly: boolean): Promise<readonly OpenRouterModel[]> => {
    const hit = cache.get(path);
    if (hit && now() - hit.at < TTL_MILLISECONDS) return hit.models;
    try {
      const response = await fetcher(`${BASE}${path}`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('CATALOG_UNAVAILABLE');
      const models = parseCatalog(await response.json() as unknown, textOutputOnly);
      cache.set(path, { at: now(), models });
      return models;
    } catch (error) {
      if (hit) return hit.models;
      throw error;
    }
  };
  return { chat: () => load('/models', true), embedding: () => load('/embeddings/models', false) };
}
