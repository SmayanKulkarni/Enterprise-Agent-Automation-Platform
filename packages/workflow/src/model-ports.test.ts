import { randomBytes } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { observe, resetObservers } from '../../telemetry/src/observe.test-support.js';
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
const run = { id: 'run-1', tenantId: tenant, status: 'completed', input: { package: 'zod' }, outputs: { agent: { verdict: 'low risk', memoryProposalIds: ['x'], evidenceComplete: true, note: 'token=abc123', apiKey: 'sk-live' } }, decisions: { gate: { outcome: 'approve', approverId: 'user-secret' } }, history: [{ nodeId: 'agent', kind: 'agent', state: 'completed' }, { nodeId: 'gate', kind: 'approval', state: 'completed' }] } as unknown as WorkflowRun;
const draft = { salient: true, subjects: ['npm:zod'], outcome: 'zod judged low risk', findings: [{ text: 'verdict low risk', sourceNodeId: 'agent', excerpt: 'low risk' }], status: 'completed' };
const chatResponse = (usage: Record<string, unknown>) => Response.json({ choices: [{ message: { content: JSON.stringify(draft) } }], usage });
const item: HostedMemoryItem = { id: '11111111-1111-4111-8111-111111111112', text: 'prefers email', metadata: { stableDefinitionId: 's', definitionId: 'd', producingRevision: 1, type: 'task-fact', sourceId: 'x', sourceDigest: 'a'.repeat(64), state: 'promoted', expiresAt: '2099-01-01T00:00:00.000Z' } };

afterEach(() => { vi.unstubAllGlobals(); resetObservers(); });

test('summary uses the tenant-selected OpenRouter model and its reported cost', async () => {
  const fetcher = vi.fn().mockResolvedValue(chatResponse({ total_tokens: 100, cost: 0.0042 }));
  vi.stubGlobal('fetch', fetcher);
  const port = new HttpModelPort({}, storeWith({ summary: { provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5' }, embedding: { provider: 'upstash' } }), crypto);
  expect(await port.summarize(run)).toEqual(draft);
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

const telemetryRequest = { ...toolRequest, model: 'anthropic/claude-sonnet-5.5', telemetry: { feature: 'workflow' as const, runId: 'run-1', nodeId: 'node-1', attempt: 2 } };
const usageResponse = (usage: Record<string, unknown>, text = 'ok') => Response.json({ choices: [{ message: { content: JSON.stringify({ result: text }) } }], usage });

test('a successful call records one span, a duration point, input and output token points, the cost and one model.call event', async () => {
  const { spans, points, events } = observe();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(usageResponse({ prompt_tokens: 60, completion_tokens: 40, total_tokens: 100, cost: 0.0042 })));
  const result = await new HttpModelPort({}, storeWith(), crypto).complete(telemetryRequest);
  const labels = { 'gen_ai.provider.name': 'openrouter', 'gen_ai.request.model': 'anthropic/claude-sonnet-5.5', tenant_id: tenant, feature: 'workflow' };
  expect(result).toMatchObject({ tokens: 100, cost: 0.0042, promptTokens: 60, completionTokens: 40 });
  expect((await spans()).map((span) => ({ name: span.name, attributes: span.attributes, status: span.status.code }))).toEqual([{ name: 'chat anthropic/claude-sonnet-5.5', attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.provider.name': 'openrouter', 'gen_ai.request.model': 'anthropic/claude-sonnet-5.5', tenant_id: tenant, feature: 'workflow', 'workflow.run_id': 'run-1', 'workflow.node_id': 'node-1' }, status: 0 }]);
  const duration = await points('gen_ai.client.operation.duration');
  expect(duration.map((point) => point.attributes)).toEqual([labels]);
  expect((duration[0]?.value as { count: number }).count).toBe(1);
  const tokens = await points('gen_ai.client.token.usage');
  expect(tokens.map((point) => ({ type: point.attributes['gen_ai.token.type'], sum: (point.value as { sum: number }).sum, attributes: point.attributes })).sort((left, right) => String(left.type).localeCompare(String(right.type)))).toEqual([{ type: 'input', sum: 60, attributes: { ...labels, 'gen_ai.token.type': 'input' } }, { type: 'output', sum: 40, attributes: { ...labels, 'gen_ai.token.type': 'output' } }]);
  expect((await points('gen_ai.client.cost')).map((point) => ({ value: point.value, attributes: point.attributes }))).toEqual([{ value: 0.0042, attributes: labels }]);
  expect(events('model.call')).toEqual([{ event: 'model.call', level: 'info', at: expect.any(String) as string, tenant_id: tenant, run_id: 'run-1', node_id: 'node-1', provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5', attempt: 2, outcome: 'succeeded', tokens: 100, cost: 0.0042, duration_s: expect.any(Number) as number }]);
});

test('a provider that reports only total_tokens yields one total token point', async () => {
  const { points } = observe();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(usageResponse({ total_tokens: 100, cost: 0.0042 })));
  await new HttpModelPort({}, storeWith(), crypto).complete(telemetryRequest);
  expect((await points('gen_ai.client.token.usage')).map((point) => ({ type: point.attributes['gen_ai.token.type'], sum: (point.value as { sum: number }).sum }))).toEqual([{ type: 'total', sum: 100 }]);
});

test('negative or non-numeric prompt and completion counts fall back to the total', async () => {
  const { points } = observe();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(usageResponse({ prompt_tokens: -1, completion_tokens: '40', total_tokens: 100, cost: 0.0042 })));
  const result = await new HttpModelPort({}, storeWith(), crypto).complete(telemetryRequest);
  expect(result.promptTokens).toBeUndefined(); expect(result.completionTokens).toBeUndefined();
  expect((await points('gen_ai.client.token.usage')).map((point) => point.attributes['gen_ai.token.type'])).toEqual(['total']);
});

test('a response without usage records no token point and no cost, and the event carries neither', async () => {
  const { points, events } = observe();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(usageResponse({})));
  const port = new HttpModelPort({ WORKFLOW_OPENROUTER_MAX_COST_PER_1K_TOKENS: '0.5' }, storeWith(), crypto);
  const result = await port.complete(telemetryRequest);
  expect(result.tokens).toBe(Infinity);
  expect(await points('gen_ai.client.token.usage')).toEqual([]);
  expect(await points('gen_ai.client.cost')).toEqual([]);
  expect((await points('gen_ai.client.operation.duration')).length).toBe(1);
  expect(events('model.call')).toEqual([expect.not.objectContaining({ tokens: expect.anything() as unknown })]);
  expect(events('model.call')[0]).not.toHaveProperty('cost');
  expect(events('model.call')[0]).toMatchObject({ outcome: 'succeeded' });
});

test('an Azure OpenAI call is labelled azure-openai and priced at the configured rate', async () => {
  const { points } = observe();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(usageResponse({ total_tokens: 2000 })));
  await new HttpModelPort({ ...environment, WORKFLOW_MAX_COST_PER_1K_TOKENS: '0.25' }, storeWith(), crypto).complete({ ...telemetryRequest, provider: 'azure-openai', model: 'gpt-4.1' });
  expect((await points('gen_ai.client.cost')).map((point) => ({ value: point.value, provider: point.attributes['gen_ai.provider.name'], model: point.attributes['gen_ai.request.model'] }))).toEqual([{ value: 0.5, provider: 'azure-openai', model: 'gpt-4.1' }]);
});

test('an HTTP 500 records the duration with a fixed error type, marks the span as an error and rethrows the original error', async () => {
  const { spans, points, events } = observe();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
  await expect(new HttpModelPort({}, storeWith(), crypto).complete(telemetryRequest)).rejects.toMatchObject({ message: 'PROVIDER_FAILED', cause: { upstreamStatus: 500 } });
  const duration = await points('gen_ai.client.operation.duration');
  expect(duration.map((point) => point.attributes['error.type'])).toEqual(['PROVIDER_FAILED']);
  const [span] = (await spans());
  expect(span?.status).toEqual({ code: 2, message: 'PROVIDER_FAILED' });
  expect(span?.attributes['error.type']).toBe('PROVIDER_FAILED');
  expect(span?.events).toEqual([]);
  expect(events('model.call')).toEqual([expect.objectContaining({ outcome: 'failed', model: 'anthropic/claude-sonnet-5.5' })]);
  expect(await points('gen_ai.client.token.usage')).toEqual([]);
  expect(await points('gen_ai.client.cost')).toEqual([]);
});

test.each([
  [new DOMException('The operation was aborted due to timeout', 'TimeoutError'), 'timeout'],
  [new DOMException('aborted', 'AbortError'), 'timeout'],
  [new Error('sk-secret-provider-message'), 'other'],
  ['not an error', 'other'],
])('the error %# is mapped to the fixed error type %s and never used as a raw label', async (thrown, expected) => {
  const { points, everything } = observe();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(thrown));
  await expect(new HttpModelPort({}, storeWith(), crypto).complete(telemetryRequest)).rejects.toBe(thrown);
  expect((await points('gen_ai.client.operation.duration')).map((point) => point.attributes['error.type'])).toEqual([expect.stringMatching(expected) as string]);
  expect(await everything()).not.toContain('sk-secret-provider-message');
});

test('an invalid model output is reported with its own error type', async () => {
  const { points } = observe();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: 'not json' } }], usage: { total_tokens: 5, cost: 0.001 } })));
  await expect(new HttpModelPort({}, storeWith(), crypto).complete(telemetryRequest)).rejects.toThrow('INVALID_MODEL_OUTPUT');
  expect((await points('gen_ai.client.operation.duration')).map((point) => point.attributes['error.type'])).toEqual(['INVALID_MODEL_OUTPUT']);
});

test('a request without telemetry defaults the feature to workflow and omits run and node from the span', async () => {
  const { spans, points } = observe();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(usageResponse({ total_tokens: 5, cost: 0.001 })));
  await new HttpModelPort({}, storeWith(), crypto).complete({ ...toolRequest, model: 'a/tooling' });
  expect((await spans())[0]?.attributes).toEqual({ 'gen_ai.operation.name': 'chat', 'gen_ai.provider.name': 'openrouter', 'gen_ai.request.model': 'a/tooling', tenant_id: tenant, feature: 'workflow' });
  expect((await points('gen_ai.client.operation.duration')).map((point) => point.attributes['feature'])).toEqual(['workflow']);
});

test('run and node ids never become metric labels', async () => {
  const { points } = observe();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(usageResponse({ total_tokens: 5, cost: 0.001 })));
  await new HttpModelPort({}, storeWith(), crypto).complete(telemetryRequest);
  for (const name of ['gen_ai.client.operation.duration', 'gen_ai.client.token.usage', 'gen_ai.client.cost']) for (const point of await points(name)) expect(Object.keys(point.attributes)).not.toEqual(expect.arrayContaining(['run_id']));
  expect(JSON.stringify(await points('gen_ai.client.operation.duration'))).not.toContain('run-1');
  expect(JSON.stringify(await points('gen_ai.client.cost'))).not.toContain('node-1');
});

test('a rejected OpenRouter model id records nothing', async () => {
  const { spans, points, events } = observe();
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(new HttpModelPort({}, storeWith(), crypto).complete({ ...telemetryRequest, model: 'not a model id; drop table' })).rejects.toThrow('DENIED');
  expect(fetcher).not.toHaveBeenCalled(); expect((await spans())).toEqual([]);
  expect(await points('gen_ai.client.operation.duration')).toEqual([]); expect(events('model.call')).toEqual([]);
});

test('the summary call is tagged with the summary feature and its run', async () => {
  const { spans, points } = observe();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(chatResponse({ total_tokens: 100, cost: 0.0042 })));
  const port = new HttpModelPort({}, storeWith({ summary: { provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5' }, embedding: { provider: 'upstash' } }), crypto);
  await port.summarize({ ...run, id: 'run-9' });
  expect((await spans())[0]?.attributes).toMatchObject({ feature: 'summary', 'workflow.run_id': 'run-9' });
  expect((await points('gen_ai.client.operation.duration')).map((point) => point.attributes['feature'])).toEqual(['summary']);
});

test('no prompt, instruction, tool argument or model output reaches any span, metric, log record or stdout line', async () => {
  const { everything } = observe();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(usageResponse({ total_tokens: 100, cost: 0.0042 }, 'MARKER_OUTPUT_9c1d')));
  const transcript = [{ role: 'assistant' as const, call: { id: 'c', name: 't0_lookup', arguments: { query: 'MARKER_ARGUMENT_2b7e' } } }, { role: 'tool' as const, callId: 'c', name: 't0_lookup', content: 'MARKER_RESULT_5d40' }];
  await new HttpModelPort({}, storeWith(), crypto).complete({ ...telemetryRequest, instructions: 'MARKER_PROMPT_7f3a', input: { text: 'MARKER_INPUT_a41c' }, context: { text: 'MARKER_CONTEXT_e803' }, transcript });
  const serialized = await everything();
  expect(serialized).toContain('gen_ai.client');
  for (const marker of ['MARKER_OUTPUT_9c1d', 'MARKER_PROMPT_7f3a', 'MARKER_INPUT_a41c', 'MARKER_CONTEXT_e803', 'MARKER_ARGUMENT_2b7e', 'MARKER_RESULT_5d40']) expect(serialized).not.toContain(marker);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('MARKER_ERROR_BODY_11aa', { status: 500 })));
  await expect(new HttpModelPort({}, storeWith(), crypto).complete({ ...telemetryRequest, instructions: 'MARKER_PROMPT_7f3a' })).rejects.toThrow();
  expect(await everything()).not.toContain('MARKER_');
});

test('the summary prompt carries bounded, redacted evidence and no approver identity or proposal bookkeeping', async () => {
  const fetcher = vi.fn().mockResolvedValue(chatResponse({ total_tokens: 10, cost: 0 }));
  vi.stubGlobal('fetch', fetcher);
  const port = new HttpModelPort({}, storeWith({ summary: { provider: 'openrouter', model: 'a/primary' }, embedding: { provider: 'upstash' } }), crypto);
  await port.summarize(run);
  const body = JSON.parse((fetcher.mock.calls[0] as [string, RequestInit])[1].body as string) as { messages: { content: string }[]; response_format: { json_schema: { strict: boolean; schema: { required: string[] } } }; max_completion_tokens: number };
  const user = JSON.parse(body.messages[1]?.content ?? '{}') as { input: { input: string; outputs: Record<string, string>; decisions: unknown[]; path: unknown[] } };
  expect(user.input.input).toBe('{"package":"zod"}');
  expect(user.input.outputs['agent']).toBe('{"apiKey":"[redacted]","note":"[redacted]","verdict":"low risk"}');
  expect(user.input.decisions).toEqual([{ nodeId: 'gate', outcome: 'approve' }]);
  expect(user.input.path).toHaveLength(2);
  expect(body.max_completion_tokens).toBeGreaterThanOrEqual(2000);
  expect(body.messages[0]?.content).toContain('workflow-summary-v2');
  expect(body.response_format.json_schema).toMatchObject({ strict: true, schema: { required: ['salient', 'subjects', 'outcome', 'findings', 'status'] } });
  expect(JSON.stringify(body)).not.toContain('user-secret');
});

test('a malformed summary draft is rejected instead of being trusted', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({ salient: true }) } }], usage: { total_tokens: 1, cost: 0 } })));
  const port = new HttpModelPort({}, storeWith({ summary: { provider: 'openrouter', model: 'a/primary' }, embedding: { provider: 'upstash' } }), crypto);
  await expect(port.summarize(run)).rejects.toThrow('INVALID_SUMMARY');
});

test('consolidation uses the tenant summary model with a strict decision schema and falls back like the summary does', async () => {
  const answer = (value: Record<string, unknown>) => Response.json({ choices: [{ message: { content: JSON.stringify(value) } }], usage: { total_tokens: 5, cost: 0 } });
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('down', { status: 503 })).mockResolvedValueOnce(answer({ decision: 'supersede', targetId: 'abc' }));
  vi.stubGlobal('fetch', fetcher);
  const port = new HttpModelPort({}, storeWith({ summary: { provider: 'openrouter', model: 'a/primary', fallback: 'b/backup' }, embedding: { provider: 'upstash' } }), crypto);
  await expect(port.consolidate({ tenantId: tenant, runId: 'run-1', item: { text: 'new', observedAt: '2026-10-05T00:00:00.000Z' }, candidates: [{ id: 'abc', text: 'old' }] })).resolves.toEqual({ decision: 'supersede', targetId: 'abc', model: 'b/backup', promptVersion: 'memory-consolidate-v1' });
  const body = JSON.parse((fetcher.mock.calls[1] as [string, RequestInit])[1].body as string) as { model: string; max_completion_tokens: number; response_format: { json_schema: { strict: boolean } } };
  expect(body).toMatchObject({ model: 'b/backup', max_completion_tokens: 1500, response_format: { json_schema: { strict: true } } });
});

test('consolidation treats an empty target as none and rejects a missing decision', async () => {
  const answer = (value: Record<string, unknown>) => Response.json({ choices: [{ message: { content: JSON.stringify(value) } }], usage: { total_tokens: 5, cost: 0 } });
  const port = new HttpModelPort({}, storeWith({ summary: { provider: 'openrouter', model: 'a/primary' }, embedding: { provider: 'upstash' } }), crypto);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(answer({ decision: 'add', targetId: '' })).mockResolvedValueOnce(answer({ targetId: '' })));
  const request = { tenantId: tenant, runId: 'run-1', item: { text: 'new' }, candidates: [{ id: 'abc', text: 'old' }] };
  expect(await port.consolidate(request)).not.toHaveProperty('targetId');
  await expect(port.consolidate(request)).rejects.toThrow('INVALID_CONSOLIDATION');
});

test('the vector query serialises subject membership and escapes quotes and backslashes', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ result: [] }));
  vi.stubGlobal('fetch', fetcher);
  const upstash = new UpstashVectorMemoryPort({ ...environment, UPSTASH_VECTOR_DIMENSION: '3' });
  await upstash.query(`tenant-${tenant}`, 'zod', 3, { state: 'promoted', subjects: { contains: "npm:zo'd\\" } });
  const body = JSON.parse((fetcher.mock.calls[0] as [string, RequestInit])[1].body as string) as { filter: string };
  expect(body.filter).toContain("subjects CONTAINS 'npm:zo\\'d\\\\'");
});
