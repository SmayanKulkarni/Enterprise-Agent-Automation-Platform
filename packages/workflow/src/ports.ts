import type { Installation, WorkflowRun } from './service.js';
import type { JsonSchema } from './graph.js';
import type { HostedMemoryItem, HostedMemoryMatch, HostedMemoryPort } from './memory.js';
import type { McpPort, ModelPort, ModelRequest, ModelResult, ModelToolCall, TranscriptEntry } from './runtime.js';
import type { WorkflowStore } from './sql.js';
import { reported } from '../../errors/src/swallow.js';
import { OpenRouterConnectionCrypto, type OpenRouterConnection } from './openrouter-connection.js';
import { DEFAULT_MODEL_SETTINGS, MODEL_SETTINGS_ID, embeddingProfile, validModel, type EmbeddingSettings, type ModelSettings } from './model-settings.js';
import { tenantOfNamespace } from './memory.js';

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const required = (environment: Readonly<Record<string, string | undefined>>, key: string): string => environment[key]?.trim() || (() => { throw new Error(`Missing ${key}.`); })();
const azureUrl = (environment: Readonly<Record<string, string | undefined>>): string => `${required(environment, 'AZURE_OPENAI_ENDPOINT').replace(/\/$/u, '')}/openai/v1`;
const azureHeaders = (environment: Readonly<Record<string, string | undefined>>): Record<string, string> => ({ 'content-type': 'application/json', 'api-key': required(environment, 'AZURE_OPENAI_API_KEY') });
const providerFailure = (upstreamStatus: unknown): Error => new Error('PROVIDER_FAILED', { cause: { upstreamStatus: typeof upstreamStatus === 'number' ? upstreamStatus : undefined } });
const responseJson = async (response: Response): Promise<Record<string, unknown>> => {
  if (!response.ok) throw providerFailure(response.status);
  const value: unknown = await response.json(); if (!object(value)) throw new Error('INVALID_PROVIDER_RESPONSE');
  if (object(value['error'])) throw providerFailure(value['error']['code']);
  return value;
};
const schema = (properties: JsonSchema['properties'], requiredFields: string[]): JsonSchema => ({ type: 'object', properties, required: requiredFields, additionalProperties: false });

const transcriptMessages = (transcript: readonly TranscriptEntry[]): Record<string, unknown>[] => transcript.map((entry) => entry.role === 'assistant'
  ? { role: 'assistant', content: null, tool_calls: [{ id: entry.call.id, type: 'function', function: { name: entry.call.name, arguments: JSON.stringify(entry.call.arguments) } }] }
  : { role: 'tool', tool_call_id: entry.callId, content: entry.content });
const toolBody = (request: ModelRequest): Record<string, unknown> => request.tools?.length ? { tools: request.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })), tool_choice: request.toolChoice ?? 'auto', parallel_tool_calls: false } : {};
const parseJson = (text: string): unknown => {
  try { return JSON.parse(text); } catch { throw new Error('INVALID_MODEL_OUTPUT'); }
};
const parseToolCall = (value: unknown): ModelToolCall | undefined => {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const first: unknown = value[0]; const call = object(first) ? first['function'] : undefined;
  if (!object(first) || typeof first['id'] !== 'string' || !first['id'] || !object(call) || typeof call['name'] !== 'string' || typeof call['arguments'] !== 'string') throw new Error('INVALID_MODEL_OUTPUT');
  const args: unknown = call['arguments'].trim() === '' ? {} : parseJson(call['arguments']);
  if (!object(args)) throw new Error('INVALID_MODEL_OUTPUT');
  return { id: first['id'], name: call['name'], arguments: args };
};
const parseOutput = (content: unknown): Record<string, unknown> => {
  if (typeof content !== 'string') throw new Error('INVALID_MODEL_OUTPUT');
  const output = parseJson(content);
  if (!object(output)) throw new Error('INVALID_MODEL_OUTPUT');
  return output;
};

const OPENROUTER_CONNECTION_ID = '00000000-0000-5000-8000-000000000002';
const tenantOpenRouterKey = async (tenantId: string, store: WorkflowStore | undefined, crypto: OpenRouterConnectionCrypto | undefined): Promise<string> => {
  const connection = await store?.workerRead<OpenRouterConnection>(tenantId, 'openrouter-connection', OPENROUTER_CONNECTION_ID);
  if (!crypto || !connection || connection.state !== 'ready' || !connection.data.enabled || !connection.data.key) throw new Error('DENIED');
  return crypto.open(tenantId, connection.data.key);
};
const tenantModelSettings = async (tenantId: string, store: WorkflowStore | undefined): Promise<ModelSettings> => (await store?.workerRead<ModelSettings>(tenantId, 'model-settings', MODEL_SETTINGS_ID))?.data ?? DEFAULT_MODEL_SETTINGS;

export class HttpModelPort implements ModelPort {
  constructor(private readonly environment: Readonly<Record<string, string | undefined>> = process.env, private readonly store?: WorkflowStore, private readonly crypto?: OpenRouterConnectionCrypto) {}
  async complete(request: ModelRequest): Promise<ModelResult> {
    if (request.provider === 'openrouter' && !validModel('openrouter', request.model)) throw new Error('DENIED');
    const url = request.provider === 'azure-openai' ? `${azureUrl(this.environment)}/chat/completions` : 'https://openrouter.ai/api/v1/chat/completions';
    const headers = request.provider === 'azure-openai' ? azureHeaders(this.environment) : { 'content-type': 'application/json', authorization: `Bearer ${await tenantOpenRouterKey(request.tenantId, this.store, this.crypto)}` };
    const body = { model: request.model, messages: [{ role: 'system', content: `${request.instructions}\nPrompt version: ${request.promptVersion}` }, { role: 'user', content: JSON.stringify({ input: request.input, context: request.context }) }, ...transcriptMessages(request.transcript ?? [])], response_format: { type: 'json_schema', json_schema: { name: 'workflow_result', strict: true, schema: request.responseSchema } }, max_completion_tokens: request.policy.tokens, ...toolBody(request), ...(request.provider === 'openrouter' ? { usage: { include: true } } : {}) };
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(request.policy.milliseconds) });
    const parsed = await responseJson(response); const choice = (parsed['choices'] as unknown[])?.[0];
    const message = object(choice) ? choice['message'] : undefined;
    const usage = parsed['usage']; const tokens = object(usage) && typeof usage['total_tokens'] === 'number' ? usage['total_tokens'] : Infinity;
    const toolCall = object(message) ? parseToolCall(message['tool_calls']) : undefined;
    const output = toolCall ? {} : parseOutput(object(message) ? message['content'] : undefined);
    const providerCost = request.provider === 'openrouter' && object(usage) && typeof usage['cost'] === 'number' && Number.isFinite(usage['cost']) && usage['cost'] >= 0 ? usage['cost'] : undefined;
    const outcome = { output, model: request.model, tokens, ...(toolCall ? { toolCall } : {}) };
    if (providerCost !== undefined) return { ...outcome, cost: providerCost };
    const rate = Number(required(this.environment, request.provider === 'openrouter' ? 'WORKFLOW_OPENROUTER_MAX_COST_PER_1K_TOKENS' : 'WORKFLOW_MAX_COST_PER_1K_TOKENS'));
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('INVALID_COST_RATE');
    return { ...outcome, cost: tokens / 1000 * rate };
  }
  async summarize(run: WorkflowRun): Promise<{ text: string; sources: string[] }> {
    const sources = [...new Set(run.history.filter((item) => item.state === 'completed').map((item) => item.nodeId))];
    if (!sources.length) throw new Error('INVALID_SUMMARY');
    const selection = (await tenantModelSettings(run.tenantId, this.store)).summary;
    if (!selection) throw new Error('SUMMARY_NOT_CONFIGURED');
    const attempt = (model: string): Promise<ModelResult> => this.complete({ tenantId: run.tenantId, provider: selection.provider, model, promptVersion: 'workflow-summary-v1', instructions: 'Summarize the workflow outcomes without adding facts. Keep the result brief.', input: { events: run.history.map((item) => ({ nodeId: item.nodeId, kind: item.kind, state: item.state })) }, context: {}, responseSchema: schema({ text: { type: 'string' } }, ['text']), policy: { milliseconds: 30000, attempts: 1, tokens: 500, cost: 1, toolRounds: 0, effects: 0 } });
    let result: ModelResult;
    try { result = await attempt(selection.model); } catch (error) {
      if (!selection.fallback) throw error;
      reported(undefined, 'ports.summary')(error); result = await attempt(selection.fallback);
    }
    return { text: String(result.output['text']), sources };
  }
}

export class HttpEmbeddingPort {
  readonly dimension: number;
  constructor(private readonly environment: Readonly<Record<string, string | undefined>> = process.env, private readonly store?: WorkflowStore, private readonly crypto?: OpenRouterConnectionCrypto) {
    this.dimension = Number(environment['UPSTASH_VECTOR_DIMENSION'] ?? '384');
  }
  async settings(tenantId: string): Promise<EmbeddingSettings> { return (await tenantModelSettings(tenantId, this.store)).embedding; }
  async embed(tenantId: string, settings: EmbeddingSettings, text: string): Promise<readonly number[]> {
    if (settings.provider === 'upstash' || !settings.model) throw new Error('INVALID_EMBEDDING_SETTINGS');
    const azure = settings.provider === 'azure-openai';
    const url = azure ? `${azureUrl(this.environment)}/embeddings` : 'https://openrouter.ai/api/v1/embeddings';
    const headers = azure ? azureHeaders(this.environment) : { 'content-type': 'application/json', authorization: `Bearer ${await tenantOpenRouterKey(tenantId, this.store, this.crypto)}` };
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ model: settings.model, input: text, dimensions: this.dimension }), signal: AbortSignal.timeout(30000) });
    const parsed = await responseJson(response); const data = parsed['data'];
    if (!Array.isArray(data) || data.length !== 1 || !object(data[0])) throw new Error('INVALID_EMBEDDINGS');
    return vector(data[0]['embedding'], this.dimension);
  }
}

export class HttpMcpPort implements McpPort {
  constructor(private readonly environment: Readonly<Record<string, string | undefined>> = process.env) {}
  async invoke(installation: Installation, capability: string, args: Record<string, unknown>, effectId: string, deadline: string): Promise<{ outcome: 'succeeded' | 'not-dispatched' | 'unknown-outcome' | 'failed'; output?: Record<string, unknown> }> {
    if (installation.route !== 'public' || !installation.endpoint) return { outcome: 'not-dispatched' };
    const url = new URL(installation.endpoint); const allowed = required(this.environment, 'WORKFLOW_MCP_ALLOWED_HOSTS').split(',').map((host) => host.trim());
    if (url.protocol !== 'https:' || !allowed.includes(url.hostname)) return { outcome: 'not-dispatched' };
    const token = this.environment[`WORKFLOW_MCP_CREDENTIAL_${installation.id.replaceAll('-', '').toUpperCase()}`];
    if (!token) return { outcome: 'not-dispatched' };
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` };
    try {
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: effectId, method: 'tools/call', params: { name: capability, arguments: args } }), signal: AbortSignal.timeout(Math.max(1, Date.parse(deadline) - Date.now())) });
      if (!response.ok) return { outcome: 'unknown-outcome' };
      const text = await response.text(); const raw = response.headers.get('content-type')?.includes('text/event-stream') ? text.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim() : text;
      if (!raw) return { outcome: 'unknown-outcome' };
      const parsed: unknown = JSON.parse(raw); if (!object(parsed) || parsed['id'] !== effectId || parsed['error'] || !object(parsed['result'])) return { outcome: 'unknown-outcome' };
      const result = parsed['result']; if (result['isError'] === true) return { outcome: 'unknown-outcome' };
      const output = result['structuredContent']; if (!object(output)) return { outcome: 'unknown-outcome' };
      return { outcome: 'succeeded', output };
    } catch (error) { return reported({ outcome: 'unknown-outcome' as const }, 'ports.mcp')(error); }
  }
}

const metadata = (value: unknown): HostedMemoryItem['metadata'] => {
  if (!object(value) || typeof value['stableDefinitionId'] !== 'string' || typeof value['definitionId'] !== 'string' || !Number.isSafeInteger(value['producingRevision']) || !['run-summary', 'task-fact', 'stated-preference'].includes(String(value['type'])) || typeof value['sourceId'] !== 'string' || typeof value['sourceDigest'] !== 'string' || !/^[a-f0-9]{64}$/iu.test(value['sourceDigest']) || value['ownerId'] !== undefined && typeof value['ownerId'] !== 'string' || !['pending', 'promoted'].includes(String(value['state'])) || typeof value['expiresAt'] !== 'string') throw new Error('INVALID_MEMORY_METADATA');
  return { stableDefinitionId: value['stableDefinitionId'], definitionId: value['definitionId'], producingRevision: value['producingRevision'] as number, type: value['type'] as HostedMemoryItem['metadata']['type'], sourceId: value['sourceId'], sourceDigest: value['sourceDigest'], ...(typeof value['ownerId'] === 'string' ? { ownerId: value['ownerId'] } : {}), state: value['state'] as 'pending' | 'promoted', ...(typeof value['promotedAt'] === 'string' ? { promotedAt: value['promotedAt'] } : {}), expiresAt: value['expiresAt'] };
};
const vector = (value: unknown, dimension: number): readonly number[] => Array.isArray(value) && value.length === dimension && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry)) ? value as number[] : (() => { throw new Error('INVALID_EMBEDDINGS'); })();
const item = (value: unknown): HostedMemoryItem => {
  if (!object(value) || typeof value['id'] !== 'string' || !/^[0-9a-f-]{36}$/iu.test(value['id']) || typeof value['text'] !== 'string' || !object(value['metadata'])) throw new Error('INVALID_MEMORY_ITEM');
  return { id: value['id'].toLowerCase(), text: value['text'], metadata: metadata(value['metadata']) };
};

export class UpstashVectorMemoryPort implements HostedMemoryPort {
  readonly readiness: HostedMemoryPort['readiness'];
  private readonly url: string | undefined;
  private readonly token: string | undefined;
  private readonly tenants: readonly string[];
  constructor(private readonly environment: Readonly<Record<string, string | undefined>> = process.env, private readonly embedding?: HttpEmbeddingPort) {
    this.url = environment['UPSTASH_VECTOR_REST_URL']?.replace(/\/$/u, ''); this.token = environment['UPSTASH_VECTOR_REST_TOKEN']; this.tenants = (environment['WORKFLOW_MEMORY_ENABLED_TENANTS'] ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    this.readiness = this.tenants.length === 0 ? 'disabled' : !this.url || !this.token ? 'not-configured' : 'ready';
  }
  enabled(tenantId: string): boolean { return this.tenants.includes(tenantId); }
  private async call(command: string, space: string, body: unknown): Promise<unknown> {
    if (this.readiness !== 'ready' || !this.url || !this.token) throw new Error('MEMORY_UNAVAILABLE');
    const response = await fetch(`${this.url}/${command}/${encodeURIComponent(space)}`, { method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('MEMORY_UNAVAILABLE');
    const parsed = await response.json() as unknown; if (!object(parsed) || !('result' in parsed)) throw new Error('INVALID_MEMORY_RESPONSE'); return parsed['result'];
  }
  private async embedded(space: string, text: string): Promise<{ profile: string; vector?: readonly number[] }> {
    const tenantId = tenantOfNamespace(space); const settings = await this.embedding?.settings(tenantId) ?? DEFAULT_MODEL_SETTINGS.embedding;
    const profile = embeddingProfile(settings);
    return this.embedding && settings.provider !== 'upstash' ? { profile, vector: await this.embedding.embed(tenantId, settings, text) } : { profile };
  }
  async upsert(space: string, value: HostedMemoryItem): Promise<void> {
    const { profile, vector: values } = await this.embedded(space, value.text); const metadata = { ...value.metadata, text: value.text, embedding: profile };
    await (values ? this.call('upsert', space, { id: value.id, vector: values, metadata }) : this.call('upsert-data', space, { id: value.id, data: value.text, metadata }));
  }
  async read(space: string, id: string): Promise<HostedMemoryItem | undefined> { const value = await this.call('fetch', space, { ids: [id], includeMetadata: true }); if (!Array.isArray(value) || value.length === 0 || value[0] === null) return undefined; const raw: unknown = value[0]; if (!object(raw) || !object(raw['metadata']) || typeof raw['metadata']['text'] !== 'string') throw new Error('INVALID_MEMORY_ITEM'); return item({ ...raw, text: raw['metadata']['text'] }); }
  async query(space: string, text: string, topK: number, filter: Record<string, string>): Promise<readonly HostedMemoryMatch[]> { const { profile, vector: values } = await this.embedded(space, text); const value = await this.call(values ? 'query' : 'query-data', space, { ...(values ? { vector: values } : { data: text }), topK, includeMetadata: true, filter: Object.entries({ ...filter, embedding: profile }).map(([key, entry]) => `${key} = '${entry.replaceAll("'", "\\'")}'`).join(' AND ') }); if (!Array.isArray(value)) throw new Error('INVALID_MEMORY_RESPONSE'); return value.map((raw: unknown) => { if (!object(raw) || typeof raw['id'] !== 'string' || typeof raw['score'] !== 'number' || !Number.isFinite(raw['score']) || !object(raw['metadata']) || typeof raw['metadata']['text'] !== 'string') throw new Error('INVALID_MEMORY_MATCH'); return { id: raw['id'].toLowerCase(), score: raw['score'], text: raw['metadata']['text'], metadata: metadata(raw['metadata']) }; }); }
  async remove(space: string, id: string): Promise<void> { await this.call('delete', space, { ids: [id] }); }
  async verifyEmbedding(tenantId: string, settings: EmbeddingSettings): Promise<void> { if (!this.embedding) throw new Error('MEMORY_UNAVAILABLE'); await this.embedding.embed(tenantId, settings, 'embedding check'); }
}
