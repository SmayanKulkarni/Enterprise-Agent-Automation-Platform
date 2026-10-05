import { expect, test, vi } from 'vitest';
import { openRouterCatalog, parseCatalog } from './openrouter-catalog.js';

const chat = { data: [
  { id: 'b/two', name: 'Two', context_length: 8000, pricing: { prompt: '0.000002', completion: '0.00001' }, supported_parameters: ['structured_outputs'], architecture: { output_modalities: ['text'] } },
  { id: 'a/one', supported_parameters: ['tools'], architecture: { output_modalities: ['text'] } },
  { id: 'c/image', architecture: { output_modalities: ['image'] } },
  { id: 'no-slash' },
] };

test('parses, filters text-output models, flags structured output and sorts', () => {
  const models = parseCatalog(chat, true);
  expect(models.map((model) => model.id)).toEqual(['a/one', 'b/two']);
  expect(models[0]).toMatchObject({ structuredOutput: false, tools: true });
  expect(models[1]?.tools).toBe(false);
  expect(models[1]).toMatchObject({ structuredOutput: true, name: 'Two', contextLength: 8000, promptPrice: 0.000002, completionPrice: 0.00001 });
});

test('rejects an unexpected payload', () => {
  expect(() => parseCatalog({ nope: true }, true)).toThrow('INVALID_CATALOG');
});

test('caches within the ttl and serves stale data when refresh fails', async () => {
  let time = 0;
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(chat)).mockRejectedValue(new Error('offline'));
  const catalog = openRouterCatalog(fetcher, () => time);
  expect(await catalog.chat()).toHaveLength(2);
  time = 60_000;
  expect(await catalog.chat()).toHaveLength(2);
  expect(fetcher).toHaveBeenCalledTimes(1);
  time = 11 * 60_000;
  expect(await catalog.chat()).toHaveLength(2);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('throws when the catalog is unavailable and nothing is cached', async () => {
  const catalog = openRouterCatalog(vi.fn<typeof fetch>().mockResolvedValue(new Response('no', { status: 503 })));
  await expect(catalog.embedding()).rejects.toThrow('CATALOG_UNAVAILABLE');
});

const decisions = { data: [
  { id: 'typesafe/jev-1.13', name: 'Jev 1.13', context_length: 32000, pricing: { prompt: '0.000000042', completion: '0' }, supported_parameters: [], architecture: { output_modalities: ['decisions'] } },
  { id: 'jaredpalmer/kev-4b', context_length: 8000, architecture: { output_modalities: ['decisions'] } },
] };

test('decisions() loads the decisions modality, keeps it apart from chat and carries the context length', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation((url) => Promise.resolve(Response.json((url as string).endsWith('output_modalities=decisions') ? decisions : chat)));
  const catalog = openRouterCatalog(fetcher);
  expect((await catalog.decisions()).map((model) => model.id)).toEqual(['jaredpalmer/kev-4b', 'typesafe/jev-1.13']);
  expect((await catalog.decisions())[1]).toMatchObject({ contextLength: 32000, structuredOutput: false, tools: false, name: 'Jev 1.13' });
  expect((await catalog.chat()).map((model) => model.id)).toEqual(['a/one', 'b/two']);
  expect(fetcher.mock.calls.map(([url]) => url as string)).toEqual(['https://openrouter.ai/api/v1/models?output_modalities=decisions', 'https://openrouter.ai/api/v1/models']);
});

test('decisions() caches within the ttl and falls back to the cached list when refresh fails', async () => {
  let time = 0;
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(decisions)).mockRejectedValue(new Error('offline'));
  const catalog = openRouterCatalog(fetcher, () => time);
  expect(await catalog.decisions()).toHaveLength(2);
  time = 60_000;
  expect(await catalog.decisions()).toHaveLength(2);
  expect(fetcher).toHaveBeenCalledTimes(1);
  time = 11 * 60_000;
  expect(await catalog.decisions()).toHaveLength(2);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('decisions() throws when nothing is cached and the catalog is down', async () => {
  const catalog = openRouterCatalog(vi.fn<typeof fetch>().mockResolvedValue(new Response('no', { status: 503 })));
  await expect(catalog.decisions()).rejects.toThrow('CATALOG_UNAVAILABLE');
});
