export type ChatProvider = 'azure-openai' | 'openrouter';
export type EmbeddingProvider = 'upstash' | ChatProvider;
export interface SummarySettings { provider: ChatProvider; model: string; fallback?: string; }
export interface EmbeddingSettings { provider: EmbeddingProvider; model?: string; }
export interface ModelSettings { summary?: SummarySettings; embedding: EmbeddingSettings; }

export const MODEL_SETTINGS_ID = '00000000-0000-5000-8000-000000000004';
export const DEFAULT_MODEL_SETTINGS: ModelSettings = { embedding: { provider: 'upstash' } };

const chatProviders: readonly string[] = ['azure-openai', 'openrouter'];
const embeddingProviders: readonly string[] = ['upstash', ...chatProviders];
const slug = /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,127}(\/[A-Za-z0-9][A-Za-z0-9._:~-]{0,127})?$/u;

const fail = (): never => { throw Object.assign(new Error('INVALID'), { code: 'INVALID' }); };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail();
const only = (value: Record<string, unknown>, keys: readonly string[]): void => { if (Object.keys(value).some((key) => !keys.includes(key))) fail(); };
export const validModel = (provider: string, value: unknown): value is string => typeof value === 'string' && slug.test(value) && (provider !== 'openrouter' || value.includes('/'));
const model = (provider: string, value: unknown): string => validModel(provider, value) ? value : fail();

export function parseModelSettings(value: unknown): ModelSettings {
  const input = object(value); only(input, ['summary', 'embedding']);
  const embedding = object(input['embedding']); only(embedding, ['provider', 'model']);
  const embeddingProvider = String(embedding['provider']);
  if (!embeddingProviders.includes(embeddingProvider)) fail();
  if (embeddingProvider === 'upstash' && embedding['model'] !== undefined) fail();
  const parsedEmbedding: EmbeddingSettings = embeddingProvider === 'upstash' ? { provider: 'upstash' } : { provider: embeddingProvider as ChatProvider, model: model(embeddingProvider, embedding['model']) };
  if (input['summary'] === undefined) return { embedding: parsedEmbedding };
  const summary = object(input['summary']); only(summary, ['provider', 'model', 'fallback']);
  const provider = String(summary['provider']);
  if (!chatProviders.includes(provider)) fail();
  const selected = model(provider, summary['model']);
  const fallback = summary['fallback'] === undefined ? undefined : model(provider, summary['fallback']);
  if (fallback === selected) fail();
  return { summary: { provider: provider as ChatProvider, model: selected, ...(fallback ? { fallback } : {}) }, embedding: parsedEmbedding };
}

export const embeddingProfile = (settings: EmbeddingSettings): string => settings.provider === 'upstash' ? 'upstash' : `${settings.provider}:${settings.model ?? ''}`;
