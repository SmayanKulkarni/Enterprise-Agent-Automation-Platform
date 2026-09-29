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
