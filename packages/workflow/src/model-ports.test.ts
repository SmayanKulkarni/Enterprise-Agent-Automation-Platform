import { randomBytes } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import type { HostedMemoryItem } from './memory.js';
import type { ModelSettings } from './model-settings.js';
import { OpenRouterConnectionCrypto } from './openrouter-connection.js';
import { HttpEmbeddingPort, HttpModelPort, UpstashVectorMemoryPort } from './ports.js';
import type { WorkflowRun } from './service.js';
import type { WorkflowStore } from './sql.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const crypto = new OpenRouterConnectionCrypto('v1', randomBytes(32));
const environment = { UPSTASH_VECTOR_REST_URL: 'https://vector.test', UPSTASH_VECTOR_REST_TOKEN: 'token', WORKFLOW_MEMORY_ENABLED_TENANTS: tenant, UPSTASH_VECTOR_DIMENSION: '3', AZURE_OPENAI_ENDPOINT: 'https://azure.test', AZURE_OPENAI_API_KEY: 'azure-key' };
const storeWith = (settings?: ModelSettings): WorkflowStore => ({
  workerRead: (_tenant: string, kind: string) => Promise.resolve(kind === 'openrouter-connection' ? { id: 'c', kind, version: 1, state: 'ready', data: { provider: 'openrouter', enabled: true, key: crypto.seal(tenant, 'tenant-key') } } : settings ? { id: 's', kind, version: 1, state: 'ready', data: settings } : undefined),
}) as unknown as WorkflowStore;
const run = { tenantId: tenant, history: [{ nodeId: 'agent', kind: 'agent', state: 'completed' }] } as unknown as WorkflowRun;
const chatResponse = (usage: Record<string, unknown>) => Response.json({ choices: [{ message: { content: JSON.stringify({ text: 'summary' }) } }], usage });
const item: HostedMemoryItem = { id: '11111111-1111-4111-8111-111111111112', text: 'prefers email', metadata: { stableDefinitionId: 's', definitionId: 'd', producingRevision: 1, type: 'task-fact', sourceId: 'x', sourceDigest: 'a'.repeat(64), state: 'promoted', expiresAt: '2099-01-01T00:00:00.000Z' } };

afterEach(() => vi.unstubAllGlobals());

test('summary uses the tenant-selected OpenRouter model and its reported cost', async () => {
  const fetcher = vi.fn().mockResolvedValue(chatResponse({ total_tokens: 100, cost: 0.0042 }));
  vi.stubGlobal('fetch', fetcher);
  const port = new HttpModelPort({}, storeWith({ summary: { provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5' }, embedding: { provider: 'upstash' } }), crypto);
  expect((await port.summarize(run)).text).toBe('summary');
  const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
  const body = JSON.parse(init.body as string) as Record<string, unknown>;
  expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
  expect(body).toMatchObject({ model: 'anthropic/claude-sonnet-5.5', usage: { include: true } });
  expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tenant-key');
});

test('summary falls back to the selected fallback model when the first call fails', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('down', { status: 503 })).mockResolvedValueOnce(chatResponse({ total_tokens: 10, cost: 0 }));
  vi.stubGlobal('fetch', fetcher);
  const port = new HttpModelPort({}, storeWith({ summary: { provider: 'openrouter', model: 'a/primary', fallback: 'b/backup' }, embedding: { provider: 'upstash' } }), crypto);
  await port.summarize(run);
  expect(fetcher.mock.calls.map(([, init]) => (JSON.parse((init as RequestInit).body as string) as { model: string }).model)).toEqual(['a/primary', 'b/backup']);
});

test('summary without a fallback surfaces the provider failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('down', { status: 503 })));
  const port = new HttpModelPort({}, storeWith({ summary: { provider: 'openrouter', model: 'a/primary' }, embedding: { provider: 'upstash' } }), crypto);
  await expect(port.summarize(run)).rejects.toThrow('PROVIDER_FAILED');
});

test('summary requires an explicit selection', async () => {
  vi.stubGlobal('fetch', vi.fn());
  await expect(new HttpModelPort({}, storeWith(), crypto).summarize(run)).rejects.toThrow('SUMMARY_NOT_CONFIGURED');
});

test('OpenRouter models are not limited to an environment allowlist but must be well-formed', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(chatResponse({ total_tokens: 1, cost: 0 })));
  const port = new HttpModelPort({}, storeWith(), crypto);
  const request = { tenantId: tenant, provider: 'openrouter' as const, instructions: 'x', promptVersion: 'v', input: {}, context: {}, responseSchema: { type: 'object' as const, properties: {}, required: [], additionalProperties: false as const }, policy: { milliseconds: 1000, attempts: 1, tokens: 10, cost: 1, toolRounds: 0, effects: 0 } };
  await expect(port.complete({ ...request, model: 'any/model-in-catalog' })).resolves.toMatchObject({ cost: 0 });
  await expect(port.complete({ ...request, model: 'not a slug' })).rejects.toThrow('DENIED');
});

test('OpenRouter cost falls back to the configured rate when the provider reports none', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(chatResponse({ total_tokens: 2000 })));
  const port = new HttpModelPort({ WORKFLOW_OPENROUTER_MAX_COST_PER_1K_TOKENS: '0.01' }, storeWith(), crypto);
  const complete = await port.complete({ tenantId: tenant, provider: 'openrouter', model: 'a/b', instructions: 'x', promptVersion: 'v', input: {}, context: {}, responseSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }, policy: { milliseconds: 1000, attempts: 1, tokens: 10, cost: 1, toolRounds: 0, effects: 0 } });
  expect(complete.cost).toBeCloseTo(0.02);
});

test('embedding through OpenRouter uses the tenant key and enforces the index dimension', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ embedding: [0.1, 0.2, 0.3] }] })).mockResolvedValueOnce(Response.json({ data: [{ embedding: [0.1, 0.2] }] }));
  vi.stubGlobal('fetch', fetcher);
  const port = new HttpEmbeddingPort(environment, storeWith(), crypto);
  const settings = { provider: 'openrouter' as const, model: 'openai/text-embedding-3-small' };
  expect(await port.embed(tenant, settings, 'hello')).toEqual([0.1, 0.2, 0.3]);
  const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('https://openrouter.ai/api/v1/embeddings');
  expect(JSON.parse(init.body as string)).toEqual({ model: 'openai/text-embedding-3-small', input: 'hello', dimensions: 3 });
  await expect(port.embed(tenant, settings, 'hello')).rejects.toThrow('INVALID_EMBEDDINGS');
});

test('embedding through Azure OpenAI uses the platform deployment', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ embedding: [1, 2, 3] }] }));
  vi.stubGlobal('fetch', fetcher);
  await new HttpEmbeddingPort(environment, storeWith(), crypto).embed(tenant, { provider: 'azure-openai', model: 'embed-small' }, 'hello');
  const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('https://azure.test/openai/v1/embeddings');
  expect((init.headers as Record<string, string>)['api-key']).toBe('azure-key');
});

test('built-in profile sends text and tags the item with its embedding profile', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ result: 'Success' }));
  vi.stubGlobal('fetch', fetcher);
  await new UpstashVectorMemoryPort(environment, new HttpEmbeddingPort(environment, storeWith(), crypto)).upsert(`tenant-${tenant}`, item);
  const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
  expect(url).toBe(`https://vector.test/upsert-data/tenant-${tenant}`);
  expect(JSON.parse(init.body as string)).toMatchObject({ id: item.id, data: 'prefers email', metadata: { embedding: 'upstash', text: 'prefers email' } });
});

test('external profile sends a vector and queries only vectors from the same profile', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ data: [{ embedding: [1, 0, 0] }] })).mockResolvedValueOnce(Response.json({ result: 'Success' }))
    .mockResolvedValueOnce(Response.json({ data: [{ embedding: [0, 1, 0] }] })).mockResolvedValueOnce(Response.json({ result: [] }));
  vi.stubGlobal('fetch', fetcher);
  const settings: ModelSettings = { embedding: { provider: 'openrouter', model: 'openai/text-embedding-3-small' } };
  const port = new UpstashVectorMemoryPort(environment, new HttpEmbeddingPort(environment, storeWith(settings), crypto));
  await port.upsert(`tenant-${tenant}`, item);
  const upsert = fetcher.mock.calls[1] as [string, RequestInit];
  expect(upsert[0]).toBe(`https://vector.test/upsert/tenant-${tenant}`);
  expect(JSON.parse(upsert[1].body as string)).toMatchObject({ vector: [1, 0, 0], metadata: { embedding: 'openrouter:openai/text-embedding-3-small' } });
  await port.query(`tenant-${tenant}`, 'contact', 3, { state: 'promoted' });
  const query = fetcher.mock.calls[3] as [string, RequestInit];
  expect(query[0]).toBe(`https://vector.test/query/tenant-${tenant}`);
  expect(JSON.parse(query[1].body as string)).toMatchObject({ vector: [0, 1, 0], topK: 3, filter: "state = 'promoted' AND embedding = 'openrouter:openai/text-embedding-3-small'" });
});

const toolRequest = { tenantId: tenant, provider: 'openrouter' as const, model: 'a/tooling', instructions: 'x', promptVersion: 'v', input: {}, context: {}, responseSchema: { type: 'object' as const, properties: { result: { type: 'string' as const } }, required: ['result'], additionalProperties: false as const }, policy: { milliseconds: 1000, attempts: 1, tokens: 10, cost: 1, toolRounds: 2, effects: 2 }, tools: [{ name: 't0_lookup', description: 'Lookup', parameters: { type: 'object' as const, properties: { query: { type: 'string' as const } }, required: ['query'], additionalProperties: false as const } }] };
const toolCallResponse = (call: Record<string, unknown>) => Response.json({ choices: [{ message: { content: null, tool_calls: [call] } }], usage: { total_tokens: 5, cost: 0.001 } });

test('a tool-call response is parsed into a single tool call and sends tools without parallel calls', async () => {
  const fetcher = vi.fn().mockResolvedValue(toolCallResponse({ id: 'call_1', type: 'function', function: { name: 't0_lookup', arguments: '{"query":"acme"}' } }));
  vi.stubGlobal('fetch', fetcher);
  const result = await new HttpModelPort({}, storeWith(), crypto).complete({ ...toolRequest, toolChoice: 'auto', transcript: [{ role: 'assistant', call: { id: 'call_0', name: 't0_lookup', arguments: { query: 'x' } } }, { role: 'tool', callId: 'call_0', name: 't0_lookup', content: '{"result":"y"}' }] });
  expect(result.toolCall).toEqual({ id: 'call_1', name: 't0_lookup', arguments: { query: 'acme' } });
  const body = JSON.parse((fetcher.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
  expect(body).toMatchObject({ tool_choice: 'auto', parallel_tool_calls: false, tools: [{ type: 'function', function: { name: 't0_lookup' } }] });
  expect(body['messages']).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'assistant', tool_calls: [expect.objectContaining({ id: 'call_0' })] }), expect.objectContaining({ role: 'tool', tool_call_id: 'call_0', content: '{"result":"y"}' })]));
});

test('malformed tool-call arguments are rejected as invalid model output', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(toolCallResponse({ id: 'call_1', type: 'function', function: { name: 't0_lookup', arguments: '{not json' } })));
  await expect(new HttpModelPort({}, storeWith(), crypto).complete(toolRequest)).rejects.toThrow('INVALID_MODEL_OUTPUT');
});

test('tool-call arguments that are not an object are rejected as invalid model output', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(toolCallResponse({ id: 'call_1', type: 'function', function: { name: 't0_lookup', arguments: '[1]' } })));
  await expect(new HttpModelPort({}, storeWith(), crypto).complete(toolRequest)).rejects.toThrow('INVALID_MODEL_OUTPUT');
});

test('without tools no tool fields are sent', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({ result: 'ok' }) } }], usage: { total_tokens: 5, cost: 0 } }));
  vi.stubGlobal('fetch', fetcher);
  await new HttpModelPort({}, storeWith(), crypto).complete({ ...toolRequest, tools: [] });
  const body = JSON.parse((fetcher.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
  expect(body).not.toHaveProperty('tools'); expect(body).not.toHaveProperty('parallel_tool_calls');
});
