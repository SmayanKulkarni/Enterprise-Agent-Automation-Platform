import { expect, test, vi } from 'vitest';
import { tenantId } from '../../contracts/src/index.js';
import type { ModelSettings } from './model-settings.js';
import type { OpenRouterCatalog } from './openrouter-catalog.js';
import { WorkflowService } from './service.js';
import type { HostedMemoryPort } from './memory.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const context = { mode: 'interactive', userId: 'user-1', tenantId: tenantId(tenant), expiresAt: '2099-01-01T00:00:00.000Z', membershipEpoch: 1, tenantEpoch: 1, sessionId: 'session-1' } as const;
const key = '22222222-2222-4222-8222-222222222222';
const catalog: OpenRouterCatalog = {
  chat: () => Promise.resolve([{ id: 'a/structured', structuredOutput: true, tools: true }, { id: 'b/plain', structuredOutput: false, tools: false }, { id: 'c/backup', structuredOutput: true, tools: true }]),
  embedding: () => Promise.resolve([{ id: 'openai/text-embedding-3-small', structuredOutput: false, tools: false }]),
  decisions: () => Promise.resolve([{ id: 'typesafe/jev-1.13', structuredOutput: false, tools: false, contextLength: 32000 }]),
};
const ready = { id: 'c', kind: 'openrouter-connection', version: 1, state: 'ready', data: { provider: 'openrouter', enabled: true, verifiedAt: '2026-01-01T00:00:00.000Z' } };
const setup = (options: { stored?: ModelSettings; connection?: unknown; memory?: Partial<HostedMemoryPort>; providers?: string[]; assertProfile?: () => Promise<void> } = {}) => {
  const write = vi.fn().mockResolvedValue({ receipt: {}, replayed: false });
  const store = {
    assertProfile: options.assertProfile ?? vi.fn().mockResolvedValue(undefined),
    read: (_context: unknown, kind: string) => Promise.resolve(kind === 'openrouter-connection' ? ('connection' in options ? options.connection : ready) : options.stored ? { id: 's', kind, version: 3, state: 'ready', data: options.stored } : undefined),
    list: (_context: unknown, kind: string) => Promise.resolve(kind === 'model-settings' && options.stored ? [{ id: 's', kind, version: 3, state: 'ready', data: options.stored }] : []),
    write,
  };
  const service = new WorkflowService(undefined as never, store as never, undefined, [], options.providers ?? ['azure-openai', 'openrouter'], () => true, () => 'ready', options.memory as HostedMemoryPort, { crypto: {} as never, verify: () => Promise.resolve(true) }, catalog);
  return { service, write };
};
const valid = { summary: { provider: 'openrouter', model: 'a/structured', fallback: 'c/backup' }, embedding: { provider: 'openrouter', model: 'openai/text-embedding-3-small' } };
const firstRecord = async (service: WorkflowService, collection: string): Promise<unknown> => ((await service.projection(context, collection))['records'] as unknown[])[0];
const code = async (promise: Promise<unknown>) => promise.then(() => 'ok', (error: unknown) => (error as { code?: string }).code);

test('saves valid explicit selections with the expected version', async () => {
  const { service, write } = setup({ memory: { verifyEmbedding: () => Promise.resolve() } });
  await expect(service.configureModelSettings(context, valid, 0, key, 'a'.repeat(64))).resolves.toEqual({ version: 1, state: 'ready' });
  expect(write).toHaveBeenCalledWith(context, 'admin', 'model-settings', '00000000-0000-5000-8000-000000000004', 0, 'ready', valid, key, 'a'.repeat(64), expect.objectContaining({ revision: 1 }));
});

test('rejects a stale version', async () => {
  expect(await code(setup({ stored: { embedding: { provider: 'upstash' } } }).service.configureModelSettings(context, valid, 0, key, 'a'.repeat(64)))).toBe('STALE');
});

test('requires an administrator', async () => {
  const denied = setup({ assertProfile: () => Promise.reject(Object.assign(new Error('DENIED'), { code: 'DENIED' })) });
  expect(await code(denied.service.configureModelSettings(context, valid, 0, key, 'a'.repeat(64)))).toBe('DENIED');
  expect(denied.write).not.toHaveBeenCalled();
});

test('rejects OpenRouter summary models without structured output or outside the catalog', async () => {
  const { service } = setup({ memory: { verifyEmbedding: () => Promise.resolve() } });
  const summary = (model: string, fallback?: string) => ({ embedding: { provider: 'upstash' }, summary: { provider: 'openrouter', model, ...(fallback ? { fallback } : {}) } });
  expect(await code(service.configureModelSettings(context, summary('b/plain'), 0, key, 'a'.repeat(64)))).toBe('INVALID');
  expect(await code(service.configureModelSettings(context, summary('a/structured', 'b/plain'), 0, key, 'a'.repeat(64)))).toBe('INVALID');
  expect(await code(service.configureModelSettings(context, summary('z/unknown'), 0, key, 'a'.repeat(64)))).toBe('INVALID');
});

test('rejects unknown OpenRouter embedding models', async () => {
  const { service } = setup({ memory: { verifyEmbedding: () => Promise.resolve() } });
  expect(await code(service.configureModelSettings(context, { embedding: { provider: 'openrouter', model: 'z/unknown' } }, 0, key, 'a'.repeat(64)))).toBe('INVALID');
});

test('requires a ready OpenRouter connection and an available provider', async () => {
  expect(await code(setup({ connection: undefined }).service.configureModelSettings(context, valid, 0, key, 'a'.repeat(64)))).toBe('FEATURE_NOT_READY');
  expect(await code(setup({ providers: ['openrouter'] }).service.configureModelSettings(context, { embedding: { provider: 'azure-openai', model: 'embed' } }, 0, key, 'a'.repeat(64)))).toBe('FEATURE_NOT_READY');
});

test('maps a wrong-size embedding to INVALID and provider outages to FEATURE_NOT_READY', async () => {
  const wrong = setup({ memory: { verifyEmbedding: () => Promise.reject(new Error('INVALID_EMBEDDINGS')) } });
  expect(await code(wrong.service.configureModelSettings(context, valid, 0, key, 'a'.repeat(64)))).toBe('INVALID');
  const outage = setup({ memory: { verifyEmbedding: () => Promise.reject(new Error('PROVIDER_FAILED')) } });
  expect(await code(outage.service.configureModelSettings(context, valid, 0, key, 'a'.repeat(64)))).toBe('FEATURE_NOT_READY');
  expect(wrong.write).not.toHaveBeenCalled();
});

test('projects the default built-in profile until an administrator saves settings', async () => {
  expect(await firstRecord(setup().service, 'workflow-model-settings')).toMatchObject({ version: 0, state: 'default', embedding: { provider: 'upstash' } });
});

test('projects saved settings and the live catalog', async () => {
  const { service } = setup({ stored: valid as ModelSettings });
  expect(await firstRecord(service, 'workflow-model-settings')).toMatchObject({ version: 3, summary: { model: 'a/structured' } });
  expect(await firstRecord(service, 'openrouter-models')).toMatchObject({ catalog: 'ready', configured: true, models: [{ id: 'a/structured', structuredOutput: true }, { id: 'b/plain', structuredOutput: false }, { id: 'c/backup', structuredOutput: true }], embeddingModels: [{ id: 'openai/text-embedding-3-small', structuredOutput: false }], decisionModels: [{ id: 'typesafe/jev-1.13', contextLength: 32000 }] });
});

const empty = { type: 'object' as const, properties: {}, required: [], additionalProperties: false as const };
const output = { type: 'object' as const, properties: { result: { type: 'string' as const } }, required: ['result'], additionalProperties: false as const };
const policy = { milliseconds: 30000, attempts: 1, tokens: 1000, cost: 1, toolRounds: 0, effects: 0 };
const agentGraph = (config: Record<string, unknown>) => {
  const node = (id: string, kind: string, extra: Record<string, unknown>) => ({ id, kind, title: id, detail: '', x: 1, y: 1, instructions: kind === 'agent' ? 'Classify.' : '', config: extra });
  return { kind: 'graph-v1' as const, nodes: [node('trigger', 'trigger', { mode: 'manual', inputSchema: empty }), node('agent', 'agent', { promptVersion: '1', responseSchema: output, policy, allowedCapabilities: [], openRouterOptIn: true, ...config }), node('done', 'end', {})], edges: [{ id: 'a', from: 'trigger', to: 'agent' }, { id: 'b', from: 'agent', to: 'done' }] };
};
const checked = async (config: Record<string, unknown>, live: OpenRouterCatalog = catalog) => {
  const studio = { get: () => Promise.resolve({ id: key, tenantId: tenant, revision: 1, state: 'draft', digest: 'd'.repeat(64), author: 'user-1', draft: agentGraph(config), createdAt: '2026-01-01T00:00:00.000Z' }), appendRun: () => Promise.resolve() };
  const store = { assertProfile: () => Promise.resolve(), read: () => Promise.resolve(ready), list: () => Promise.resolve([]) };
  const service = new WorkflowService(studio as never, store as never, undefined, [], ['azure-openai', 'openrouter'], () => true, () => 'ready', undefined, { crypto: {} as never, verify: () => Promise.resolve(true) }, live);
  return (await service.check(context, key)).issues.map((issue) => issue.code);
};

test('publish checks accept any structured-output model from the live catalog', async () => {
  expect(await checked({ provider: 'openrouter', model: 'a/structured', fallback: 'c/backup' })).toEqual([]);
});

test('publish checks reject models missing from the live catalog or lacking structured output', async () => {
  expect(await checked({ provider: 'openrouter', model: 'z/unknown' })).toContain('OPENROUTER_MODEL_NOT_ALLOWED');
  expect(await checked({ provider: 'openrouter', model: 'b/plain' })).toContain('OPENROUTER_STRUCTURED_OUTPUT_UNSUPPORTED');
});

test('publish checks report an unavailable catalog instead of guessing', async () => {
  const offline: OpenRouterCatalog = { chat: () => Promise.reject(new Error('offline')), embedding: () => Promise.reject(new Error('offline')), decisions: () => Promise.reject(new Error('offline')) };
  expect(await checked({ provider: 'openrouter', model: 'a/structured' }, offline)).toContain('OPENROUTER_CATALOG_UNAVAILABLE');
});

const judgmentGraph = (config: Record<string, unknown> = {}, policyPatch: Record<string, unknown> = {}) => {
  const node = (id: string, kind: string, extra: Record<string, unknown>) => ({ id, kind, title: id, detail: '', x: 1, y: 1, instructions: '', config: extra });
  return { kind: 'graph-v1' as const, nodes: [
    node('trigger', 'trigger', { mode: 'manual', inputSchema: { ...empty, properties: { body: { type: 'string' as const } }, required: ['body'] } }),
    node('triage', 'judgment', { provider: 'openrouter', openRouterOptIn: true, model: 'typesafe/jev-1.13', questions: { team: { type: 'noul', instructions: 'Is it a refund?' } }, state: { ticket: '$input.body' }, thresholds: { act: 0.85, review: 0.6 }, policy: { ...policy, tokens: 8000, ...policyPatch }, ...config }),
    node('done', 'end', {}),
  ], edges: [{ id: 'a', from: 'trigger', to: 'triage' }, { id: 'b', from: 'triage', to: 'done' }] };
};
const judged = async (graph: unknown, options: { live?: OpenRouterCatalog; connection?: unknown; providers?: string[] } = {}) => {
  const studio = { get: () => Promise.resolve({ id: key, tenantId: tenant, revision: 1, state: 'draft', digest: 'd'.repeat(64), author: 'user-1', draft: graph, createdAt: '2026-01-01T00:00:00.000Z' }), appendRun: () => Promise.resolve() };
  const store = { assertProfile: () => Promise.resolve(), read: () => Promise.resolve('connection' in options ? options.connection : ready), list: () => Promise.resolve([]) };
  const service = new WorkflowService(studio as never, store as never, undefined, [], options.providers ?? ['azure-openai', 'openrouter'], () => true, () => 'ready', undefined, { crypto: {} as never, verify: () => Promise.resolve(true) }, options.live ?? catalog);
  return (await service.check(context, key)).issues.map((issue) => issue.code);
};

test('a Judgment on a decisions-catalog model passes check', async () => {
  expect(await judged(judgmentGraph())).toEqual([]);
});

test('a Judgment model outside the decisions catalog, even a chat model, is not allowed', async () => {
  expect(await judged(judgmentGraph({ model: 'a/structured' }))).toContain('JUDGMENT_MODEL_NOT_ALLOWED');
  expect(await judged(judgmentGraph({ model: 'z/unknown' }))).toContain('JUDGMENT_MODEL_NOT_ALLOWED');
});

test('a policy token limit above the model context window is rejected', async () => {
  expect(await judged(judgmentGraph({}, { tokens: 32001 }))).toContain('JUDGMENT_CONTEXT_EXCEEDED');
  expect(await judged(judgmentGraph({}, { tokens: 32000 }))).toEqual([]);
});

test('an unknown context length does not block a Judgment', async () => {
  const open: OpenRouterCatalog = { ...catalog, decisions: () => Promise.resolve([{ id: 'typesafe/jev-1.13', structuredOutput: false, tools: false }]) };
  expect(await judged(judgmentGraph({}, { tokens: 100000 }), { live: open })).toEqual([]);
});

test('an unready connection, an unavailable decisions catalog and a missing provider are reported', async () => {
  expect(await judged(judgmentGraph(), { connection: undefined })).toContain('OPENROUTER_CONNECTION_NOT_READY');
  const offline: OpenRouterCatalog = { ...catalog, decisions: () => Promise.reject(new Error('offline')) };
  expect(await judged(judgmentGraph(), { live: offline })).toContain('OPENROUTER_CATALOG_UNAVAILABLE');
  expect(await judged(judgmentGraph(), { providers: ['azure-openai'] })).toContain('PROVIDER_NOT_READY');
});

test('the decisions catalog loads only when a Judgment exists', async () => {
  const decisions = vi.fn().mockResolvedValue([]);
  const spied: OpenRouterCatalog = { ...catalog, decisions };
  expect(await checked({ provider: 'openrouter', model: 'a/structured' }, spied)).toEqual([]);
  expect(decisions).not.toHaveBeenCalled();
  await judged(judgmentGraph(), { live: spied });
  expect(decisions).toHaveBeenCalledTimes(1);
});

test('agent-only graphs ignore an unavailable decisions catalog', async () => {
  const offline: OpenRouterCatalog = { ...catalog, decisions: () => Promise.reject(new Error('offline')) };
  expect(await checked({ provider: 'openrouter', model: 'a/structured' }, offline)).toEqual([]);
});
