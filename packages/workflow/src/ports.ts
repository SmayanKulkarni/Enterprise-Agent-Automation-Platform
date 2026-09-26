import type { Installation, WorkflowRun } from './service.js';
import type { JsonSchema } from './graph.js';
import type { HostedMemoryItem, HostedMemoryMatch, HostedMemoryPort } from './memory.js';
import type { McpPort, ModelPort, ModelRequest, ModelResult } from './runtime.js';
import type { WorkflowStore } from './sql.js';
import { OpenRouterConnectionCrypto, type OpenRouterConnection } from './openrouter-connection.js';

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const required = (environment: Readonly<Record<string, string | undefined>>, key: string): string => environment[key]?.trim() || (() => { throw new Error(`Missing ${key}.`); })();
const azureUrl = (environment: Readonly<Record<string, string | undefined>>): string => `${required(environment, 'AZURE_OPENAI_ENDPOINT').replace(/\/$/u, '')}/openai/v1`;
const azureHeaders = (environment: Readonly<Record<string, string | undefined>>): Record<string, string> => ({ 'content-type': 'application/json', 'api-key': required(environment, 'AZURE_OPENAI_API_KEY') });
const responseJson = async (response: Response): Promise<Record<string, unknown>> => {
  if (!response.ok) throw new Error('PROVIDER_FAILED');
  const value: unknown = await response.json(); if (!object(value)) throw new Error('INVALID_PROVIDER_RESPONSE'); return value;
};
const schema = (properties: JsonSchema['properties'], requiredFields: string[]): JsonSchema => ({ type: 'object', properties, required: requiredFields, additionalProperties: false });

export class HttpModelPort implements ModelPort {
  constructor(private readonly environment: Readonly<Record<string, string | undefined>> = process.env, private readonly openRouter?: { store: WorkflowStore; crypto: OpenRouterConnectionCrypto }) {}
  async complete(request: ModelRequest): Promise<ModelResult> {
    if (request.provider === 'openrouter' && !required(this.environment, 'WORKFLOW_OPENROUTER_MODELS').split(',').map((model) => model.trim()).includes(request.model)) throw new Error('DENIED');
    const connection = request.provider === 'openrouter' ? await this.openRouter?.store.workerRead<OpenRouterConnection>(request.tenantId, 'openrouter-connection', '00000000-0000-5000-8000-000000000002') : undefined;
    if (request.provider === 'openrouter' && (!connection || connection.state !== 'ready' || !connection.data.enabled || !connection.data.key)) throw new Error('DENIED');
    const url = request.provider === 'azure-openai' ? `${azureUrl(this.environment)}/chat/completions` : 'https://openrouter.ai/api/v1/chat/completions';
    const headers = request.provider === 'azure-openai' ? azureHeaders(this.environment) : { 'content-type': 'application/json', authorization: `Bearer ${this.openRouter!.crypto.open(request.tenantId, connection!.data.key!)}` };
    const body = { model: request.model, messages: [{ role: 'system', content: `${request.instructions}\nPrompt version: ${request.promptVersion}` }, { role: 'user', content: JSON.stringify({ input: request.input, context: request.context }) }], response_format: { type: 'json_schema', json_schema: { name: 'workflow_result', strict: true, schema: request.responseSchema } }, max_completion_tokens: request.policy.tokens };
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(request.policy.milliseconds) });
    const parsed = await responseJson(response); const choice = (parsed['choices'] as unknown[])?.[0];
    const message = object(choice) ? choice['message'] : undefined; const content = object(message) ? message['content'] : undefined;
    if (typeof content !== 'string') throw new Error('INVALID_MODEL_OUTPUT');
    const output: unknown = JSON.parse(content); if (!object(output)) throw new Error('INVALID_MODEL_OUTPUT');
    const usage = parsed['usage']; const tokens = object(usage) && typeof usage['total_tokens'] === 'number' ? usage['total_tokens'] : Infinity;
    const rate = Number(required(this.environment, request.provider === 'openrouter' ? 'WORKFLOW_OPENROUTER_MAX_COST_PER_1K_TOKENS' : 'WORKFLOW_MAX_COST_PER_1K_TOKENS'));
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('INVALID_COST_RATE');
    return { output, model: request.model, tokens, cost: tokens / 1000 * rate };
  }
  async summarize(run: WorkflowRun): Promise<{ text: string; sources: string[] }> {
    const sources = [...new Set(run.history.filter((item) => item.state === 'completed').map((item) => item.nodeId))];
    if (!sources.length) throw new Error('INVALID_SUMMARY');
    const result = await this.complete({ tenantId: run.tenantId, provider: 'azure-openai', model: required(this.environment, 'AZURE_OPENAI_SUMMARY_MODEL'), promptVersion: 'workflow-summary-v1', instructions: 'Summarize the workflow outcomes without adding facts. Keep the result brief.', input: { events: run.history.map((item) => ({ nodeId: item.nodeId, kind: item.kind, state: item.state })) }, context: {}, responseSchema: schema({ text: { type: 'string' } }, ['text']), policy: { milliseconds: 30000, attempts: 1, tokens: 500, cost: 1, toolRounds: 0, effects: 0 } });
    return { text: String(result.output['text']), sources };
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
    } catch { return { outcome: 'unknown-outcome' }; }
  }
}

const vector = (value: unknown, dimension?: number): readonly number[] => Array.isArray(value) && value.length > 0 && (!dimension || value.length === dimension) && value.every((item) => typeof item === 'number' && Number.isFinite(item)) ? value as number[] : (() => { throw new Error('INVALID_VECTOR'); })();
const metadata = (value: unknown): HostedMemoryItem['metadata'] => {
  if (!object(value) || typeof value['stableDefinitionId'] !== 'string' || typeof value['definitionId'] !== 'string' || !Number.isSafeInteger(value['producingRevision']) || !['run-summary', 'task-fact', 'stated-preference'].includes(String(value['type'])) || typeof value['sourceId'] !== 'string' || typeof value['sourceDigest'] !== 'string' || !/^[a-f0-9]{64}$/iu.test(value['sourceDigest']) || value['ownerId'] !== undefined && typeof value['ownerId'] !== 'string' || !['pending', 'promoted'].includes(String(value['state'])) || typeof value['expiresAt'] !== 'string') throw new Error('INVALID_MEMORY_METADATA');
  return { stableDefinitionId: value['stableDefinitionId'], definitionId: value['definitionId'], producingRevision: value['producingRevision'] as number, type: value['type'] as HostedMemoryItem['metadata']['type'], sourceId: value['sourceId'], sourceDigest: value['sourceDigest'], ...(typeof value['ownerId'] === 'string' ? { ownerId: value['ownerId'] } : {}), state: value['state'] as 'pending' | 'promoted', ...(typeof value['promotedAt'] === 'string' ? { promotedAt: value['promotedAt'] } : {}), expiresAt: value['expiresAt'] };
};
const item = (value: unknown, dimension: number): HostedMemoryItem => {
  if (!object(value) || typeof value['id'] !== 'string' || !/^[0-9a-f-]{36}$/iu.test(value['id']) || typeof value['text'] !== 'string' || !object(value['metadata'])) throw new Error('INVALID_MEMORY_ITEM');
  return { id: value['id'].toLowerCase(), text: value['text'], vector: vector(value['vector'], dimension), metadata: metadata(value['metadata']) };
};

export class UpstashVectorMemoryPort implements HostedMemoryPort {
  readonly readiness: HostedMemoryPort['readiness'];
  private readonly url: string | undefined;
  private readonly token: string | undefined;
  private readonly tenants: readonly string[];
  private readonly dimension: number;
  constructor(private readonly environment: Readonly<Record<string, string | undefined>> = process.env) {
    this.url = environment['UPSTASH_VECTOR_REST_URL']?.replace(/\/$/u, ''); this.token = environment['UPSTASH_VECTOR_REST_TOKEN']; this.tenants = (environment['WORKFLOW_MEMORY_ENABLED_TENANTS'] ?? '').split(',').map((value) => value.trim()).filter(Boolean); this.dimension = Number(environment['AZURE_OPENAI_EMBEDDING_DIMENSION'] ?? '0');
    this.readiness = this.tenants.length === 0 ? 'disabled' : !this.url || !this.token || !environment['AZURE_OPENAI_EMBEDDING_MODEL'] || !Number.isSafeInteger(this.dimension) || this.dimension < 1 || this.dimension > 1536 ? 'not-configured' : 'ready';
  }
  enabled(tenantId: string): boolean { return this.tenants.includes(tenantId); }
  private async call(path: string, body?: unknown): Promise<unknown> {
    if (this.readiness !== 'ready' || !this.url || !this.token) throw new Error('MEMORY_UNAVAILABLE');
    const response = await fetch(`${this.url}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('MEMORY_UNAVAILABLE'); return response.json() as Promise<unknown>;
  }
  async embed(text: string): Promise<readonly number[]> {
    const response = await fetch(`${azureUrl(this.environment)}/embeddings`, { method: 'POST', headers: azureHeaders(this.environment), body: JSON.stringify({ model: required(this.environment, 'AZURE_OPENAI_EMBEDDING_MODEL'), input: text, dimensions: this.dimension }), signal: AbortSignal.timeout(30000) });
    const parsed = await responseJson(response); const data = parsed['data']; if (!Array.isArray(data) || data.length !== 1 || !object(data[0])) throw new Error('INVALID_EMBEDDINGS'); return vector(data[0]['embedding'], this.dimension);
  }
  async upsert(space: string, value: HostedMemoryItem): Promise<void> { await this.call('/upsert', { namespace: space, vectors: [{ id: value.id, vector: value.vector, metadata: { ...value.metadata, text: value.text } }] }); }
  async read(space: string, id: string): Promise<HostedMemoryItem | undefined> { const value = await this.call('/fetch', { namespace: space, ids: [id], includeVectors: true }); if (!object(value) || !Array.isArray(value['vectors']) || value['vectors'].length === 0) return undefined; const raw = value['vectors'][0]; if (!object(raw) || !object(raw['metadata']) || typeof raw['metadata']['text'] !== 'string') throw new Error('INVALID_MEMORY_ITEM'); return item({ ...raw, text: raw['metadata']['text'] }, this.dimension); }
  async query(space: string, query: readonly number[], topK: number, filter: Record<string, string>): Promise<readonly HostedMemoryMatch[]> { const value = await this.call('/query', { namespace: space, vector: query, topK, includeMetadata: true, filter: Object.entries(filter).map(([key, item]) => `${key} = '${item.replaceAll("'", "\\'")}'`).join(' AND ') }); if (!object(value) || !Array.isArray(value['matches'])) throw new Error('INVALID_MEMORY_RESPONSE'); return value['matches'].map((raw) => { if (!object(raw) || typeof raw['id'] !== 'string' || typeof raw['score'] !== 'number' || !Number.isFinite(raw['score']) || !object(raw['metadata']) || typeof raw['metadata']['text'] !== 'string') throw new Error('INVALID_MEMORY_MATCH'); return { id: raw['id'].toLowerCase(), score: raw['score'], text: raw['metadata']['text'], metadata: metadata(raw['metadata']) }; }); }
  async remove(space: string, id: string): Promise<void> { await this.call('/delete', { namespace: space, ids: [id] }); }
}
