import { afterEach, expect, test, vi } from 'vitest';
import { HttpModelPort } from './ports.js';
import type { ModelRequest } from './runtime.js';

const request = { tenantId: '11111111-1111-4111-8111-111111111111', provider: 'azure-openai', model: 'gpt-4.1', promptVersion: 'v1', instructions: 'x', input: {}, context: {}, responseSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }, policy: { milliseconds: 1000, attempts: 1, tokens: 10, cost: 1, toolRounds: 0, effects: 0 } } as unknown as ModelRequest;
const port = new HttpModelPort({ AZURE_OPENAI_ENDPOINT: 'https://azure.test', AZURE_OPENAI_API_KEY: 'k', WORKFLOW_MAX_COST_PER_1K_TOKENS: '0.01' });
const failure = async (): Promise<Error & { cause?: unknown }> => port.complete(request).then(() => { throw new Error('expected rejection'); }, (error: Error) => error);

afterEach(() => vi.unstubAllGlobals());

test('an HTTP 200 response carrying an error body is a provider failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 503, message: 'overloaded' } })));
  expect((await failure()).message).toBe('PROVIDER_FAILED');
});

test('a provider failure exposes only the upstream status, never the body', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret-detail', { status: 429 })));
  const error = await failure();
  expect(error.message).toBe('PROVIDER_FAILED');
  expect(error.cause).toEqual({ upstreamStatus: 429 });
});
