import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { digest } from '../../contracts/src/index.js';
import type { ExecutionContext } from '../../identity/src/index.js';
import type { StudioStore, StudioStoredDraft } from '../../lifecycle/src/studio-sql.js';
import type { StudioDraft } from '../../lifecycle/src/studio.js';
import { compileGraph, validateGraph, type CompiledNode, validateSchema, validateValue, type CapabilityPin, type GraphDraft, type GraphIssue, type GraphNode, type JsonSchema, type WorkflowDefinition } from './graph.js';
import type { ConsolidationRecord } from './memory-consolidation.js';
import { maxMemoryExpiry, memoryExpiry, memoryFingerprint, memoryItemId, redacted, type HostedMemoryPort, type MemoryImport, type MemoryItem } from './memory.js';
import type { PublishedDefinition, RunHistoryCursor, WorkflowRecord, WorkflowStore } from './sql.js';
import type { AgentProgress, EffectData } from './runtime.js';
import { OpenRouterConnectionCrypto, type OpenRouterConnection } from './openrouter-connection.js';
import { DEFAULT_MODEL_SETTINGS, MODEL_SETTINGS_ID, parseModelSettings, type ModelSettings } from './model-settings.js';
import type { OpenRouterCatalog, OpenRouterModel } from './openrouter-catalog.js';
import { report } from '../../errors/src/report.js';
import { logEvent } from '../../telemetry/src/events.js';
import { count } from '../../telemetry/src/instruments.js';
import { approvalDecided, runFinished, runStarted } from './run-telemetry.js';
import { githubDelivery, mapDelivery, verifyGithubSignature, WEBHOOK_BODY_LIMIT } from './github-ingress.js';
import { labelOf } from './label.js';
import { subjectOf, supersedePrevious, type Subject } from './subject.js';

export interface CapabilityManifest { digest: string; version: string; certified: boolean; capabilities: readonly { name: string; risk: 'R1' | 'R2' | 'R3'; inputSchema: JsonSchema; outputSchema: JsonSchema; tool?: string; fixed?: Readonly<Record<string, string | number | boolean>>; targetFields?: readonly string[] }[]; }
export interface Installation { id: string; route: 'public' | 'private'; endpoint?: string; tokenHash?: string; health: 'healthy' | 'offline' | 'revoked'; manifest: CapabilityManifest; }
export interface CapabilityGrant { draftId: string; nodeId: string; installationId: string; capability: string; manifestDigest: string; }
export interface WebhookCredential { definitionId: string; secret: string; enabled: boolean; rotatedAt: string; previousSecret?: string; previousExpiresAt?: string; }
interface WebhookDispatch { definitionId: string; }
export interface RunEvent { nodeId: string; kind: string; state: 'attempted' | 'completed' | 'waiting' | 'failed' | 'unknown-outcome' | 'rejected' | 'expired' | 'cancelled' | 'superseded'; at: string; detail?: string; receiptId?: string; bindingDigest?: string; }
export type NonFailureOutcome = 'rejected' | 'expired' | 'cancelled' | 'superseded';
export const NON_FAILURE_OUTCOMES: readonly NonFailureOutcome[] = ['rejected', 'expired', 'cancelled', 'superseded'];
export interface DecisionRecord { outcome: 'approve' | 'reject'; reason?: string; approverId: string; decidedAt: string; bindingDigest: string; argumentsDigest?: string; facts: readonly { name: string; value: string }[]; }
export interface RunUsage { tokens: number; cost: number; modelCalls: number; }
export interface WorkflowRun { id: string; tenantId: string; ownerId: string; stableDefinitionId: string; definitionId: string; definitionRevision: number; definitionDigest: string; inputDigest: string; input: Record<string, unknown>; status: 'queued' | 'running' | 'waiting-approval' | 'waiting-connector' | 'unknown-outcome' | 'failed' | 'completed' | NonFailureOutcome; history: RunEvent[]; decisions?: Record<string, DecisionRecord>; subject?: Subject; label?: string; outcomeLabel?: string; outputs: Record<string, Record<string, unknown>>; nodeDeadlines?: Record<string, string>; agents?: Record<string, AgentProgress>; waiting?: { nodeId: string; bindingDigest: string; expiresAt: string; requestedAt?: string; review?: { revision: number; installationId: string; capability: string; target: string; argumentsDigest: string; arguments: readonly { name: string; type: string }[]; facts?: readonly { name: string; value: string }[] } }; summaryStatus?: 'pending' | 'ready' | 'failed' | 'disabled' | 'unavailable'; usage?: RunUsage; }
export interface Scheduler { start(runId: string, tenantId: string, definitionId: string): Promise<void>; raise(runId: string, name: string, value: unknown): Promise<void>; promoteMemory?(runId: string, tenantId: string): Promise<void>; correctMemory?(itemId: string, tenantId: string, text: string): Promise<void>; removeMemory?(itemId: string, tenantId: string): Promise<void>; }
export type WebhookDeliveryOutcome = 'accepted' | 'invalid-shape' | 'signature' | 'freshness' | 'replay' | 'credential-state' | 'not-found' | 'conflict' | 'ignored' | 'too-large';
export interface WebhookDelivery { outcome: WebhookDeliveryOutcome; runId?: string; }
export type { OpenRouterModel } from './openrouter-catalog.js';
type MemoryReadiness = 'disabled' | 'not-configured' | 'ready' | 'unavailable';

const REASON_LIMIT = 1000;
const MAX_FIXED_ARGUMENTS = 8;
const targetFieldsValid = (item: { inputSchema: JsonSchema; targetFields?: unknown }): boolean => item.targetFields === undefined || Array.isArray(item.targetFields) && item.targetFields.length >= 1 && new Set(item.targetFields).size === item.targetFields.length && item.targetFields.every((name: unknown) => typeof name === 'string' && name in item.inputSchema.properties);
const variantValid = (item: { inputSchema: JsonSchema; tool?: unknown; fixed?: unknown; targetFields?: unknown }): boolean => {
  if (!targetFieldsValid(item)) return false;
  if (item.tool !== undefined && (typeof item.tool !== 'string' || item.tool.length === 0 || item.tool.length > 128)) return false;
  if (item.fixed === undefined) return true;
  if (item.fixed === null || typeof item.fixed !== 'object' || Array.isArray(item.fixed)) return false;
  const entries = Object.entries(item.fixed);
  return entries.length >= 1 && entries.length <= MAX_FIXED_ARGUMENTS && entries.every(([key, value]) => !(key in item.inputSchema.properties) && ['string', 'number', 'boolean'].includes(typeof value));
};
const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const id = (value: unknown): string => typeof value === 'string' && uuid.test(value) ? value : fail('INVALID');
const runHistoryCursor = (tenantId: string, cursor: RunHistoryCursor): string => Buffer.from(`${tenantId}.${JSON.stringify(cursor)}`).toString('base64url');
const decodeRunHistoryCursor = (value: string, tenantId: string): RunHistoryCursor => {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const separator = decoded.indexOf('.');
    if (separator < 1 || decoded.slice(0, separator) !== tenantId) return fail('DENIED');
    const parsed: unknown = JSON.parse(decoded.slice(separator + 1));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('INVALID');
    const cursor = parsed as Record<string, unknown>;
    if (typeof cursor['createdAt'] !== 'string' || cursor['createdAt'].length > 33 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?$/u.test(cursor['createdAt']) || !uuid.test(String(cursor['id']))) return fail('INVALID');
    return { createdAt: cursor['createdAt'], id: String(cursor['id']) };
  } catch (error) { if (error instanceof Error && 'code' in error) throw error; return fail('INVALID'); }
};
export const webhookRunId = (tenantId: string, definitionId: string, eventId: string): string => {
  const bytes = createHash('sha256').update(`${tenantId}:${definitionId}:${eventId}:webhook-run`).digest(); bytes[6] = (bytes[6]! & 0x0f) | 0x50; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return `${bytes.subarray(0, 4).toString('hex')}-${bytes.subarray(4, 6).toString('hex')}-${bytes.subarray(6, 8).toString('hex')}-${bytes.subarray(8, 10).toString('hex')}-${bytes.subarray(10, 16).toString('hex')}`;
};
const webhookMessage = (tenantId: string, definitionId: string, timestamp: string, eventId: string, body: Uint8Array): Buffer => Buffer.concat([Buffer.from(`${tenantId}:${definitionId}:${timestamp}:${eventId}:`), Buffer.from(body)]);
const credentialSecrets = (credential: WorkflowRecord<WebhookCredential> | undefined, fallback: string | undefined, now: number): readonly string[] => {
  if (!credential) return fallback ? [fallback] : [];
  if (credential.state !== 'active' || !credential.data.enabled) return [];
  return [credential.data.secret, ...(credential.data.previousSecret && credential.data.previousExpiresAt && Date.parse(credential.data.previousExpiresAt) > now ? [credential.data.previousSecret] : [])];
};

const TRUSTED_WEBHOOK_OUTCOMES: ReadonlySet<WebhookDeliveryOutcome> = new Set(['accepted', 'replay', 'conflict', 'ignored', 'signature', 'credential-state']);
type WebhookRequest = { tenantId: string | undefined; definitionId: string | undefined; eventId: string | undefined; timestamp: string | undefined; signature: string | undefined; body: Uint8Array; fallbackSecret?: string; now?: number; headers?: Readonly<Record<string, string | undefined>> };

export async function deliverWebhook(store: WorkflowStore, scheduler: Scheduler, request: WebhookRequest): Promise<WebhookDelivery> {
  const delivery = await admitWebhook(store, scheduler, request);
  const trusted = TRUSTED_WEBHOOK_OUTCOMES.has(delivery.outcome);
  const tenantId = trusted ? request.tenantId : undefined; const definitionId = trusted ? request.definitionId : undefined;
  count('workflow.webhook.deliveries', { tenant_id: tenantId ?? 'unknown', outcome: delivery.outcome });
  logEvent('webhook.delivery', { tenant_id: tenantId, definition_id: definitionId, outcome: delivery.outcome });
  if (delivery.outcome === 'accepted' && tenantId && definitionId && delivery.runId) runStarted(tenantId, delivery.runId, definitionId, 'webhook', `webhook:${definitionId}`);
  return delivery;
}

async function admitWebhook(store: WorkflowStore, scheduler: Scheduler, request: WebhookRequest): Promise<WebhookDelivery> {
  if (request.body.byteLength > WEBHOOK_BODY_LIMIT) return { outcome: 'too-large' };
  if (request.headers?.['x-hub-signature-256'] !== undefined) return admitGithub(store, scheduler, request);
  const { tenantId, definitionId, eventId, timestamp, signature, body } = request;
  const now = request.now ?? Date.now();
  if (!uuid.test(tenantId ?? '') || !uuid.test(definitionId ?? '') || !uuid.test(eventId ?? '') || !timestamp || !signature || !/^sha256=[a-f0-9]{64}$/iu.test(signature)) return { outcome: 'invalid-shape' };
  const tenant = tenantId as string; const definition = definitionId as string; const event = eventId as string; const signedAt = timestamp as string; const signedValue = signature as string;
  const time = Date.parse(signedAt);
  if (!Number.isFinite(time) || Math.abs(now - time) > 300000) return { outcome: 'freshness' };
  const published = await store.workerDefinition(tenant, definition);
  if (!published) return { outcome: 'not-found' };
  const credential = await store.workerRead<WebhookCredential>(tenant, 'webhook-credential', definition);
  const secrets = credentialSecrets(credential, request.fallbackSecret, now);
  if (!secrets.length) return { outcome: 'credential-state' };
  const received = Buffer.from(signedValue.slice(7), 'hex');
  if (!secrets.some((secret) => timingSafeEqual(createHmac('sha256', secret).update(webhookMessage(tenant, definition, signedAt, event, body)).digest(), received))) return { outcome: 'signature' };
  let input: unknown;
  try { input = JSON.parse(Buffer.from(body).toString('utf8')); } catch { return { outcome: 'invalid-shape' }; }
  const trigger = published.definition.nodes.find((node) => node.id === published.definition.start);
  if (trigger?.config['mode'] !== 'webhook' || !validateValue(input, trigger.config['inputSchema'] as JsonSchema)) return { outcome: 'invalid-shape' };
  return admitRun(store, scheduler, tenant, definition, event, published, trigger, input as Record<string, unknown>);
}

async function admitRun(store: WorkflowStore, scheduler: Scheduler, tenant: string, definition: string, event: string, published: PublishedDefinition, trigger: CompiledNode, input: Record<string, unknown>): Promise<WebhookDelivery> {
  const runId = webhookRunId(tenant, definition, event); const subject = subjectOf(trigger.config, input); const label = labelOf(trigger.config, input);
  const run: WorkflowRun = { ...(subject ? { subject } : {}), ...(label ? { label } : {}), id: runId, tenantId: tenant, ownerId: `webhook:${definition}`, stableDefinitionId: published.draftId, definitionId: definition, definitionRevision: published.draftRevision, definitionDigest: published.digest, inputDigest: await digest(input), input, status: 'queued', history: [], outputs: {}, summaryStatus: 'pending' };
  const sameDelivery = async (): Promise<boolean> => (await store.workerRead<WorkflowRun>(tenant, 'run', runId))?.data.inputDigest === run.inputDigest;
  let admitted: boolean;
  try { admitted = store.admitWebhookRun ? await store.admitWebhookRun(tenant, runId, definition, run.inputDigest, run) : (await store.workerWrite(tenant, 'run', runId, 0, 'queued', run), await store.workerWrite(tenant, 'webhook-dispatch', runId, 0, 'pending', { definitionId: definition }), true); }
  catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'CONFLICT') return { outcome: 'conflict' };
    if (code !== 'STALE') throw error;
    if (!await sameDelivery()) return { outcome: 'conflict' };
    admitted = false;
  }
  if (!admitted && !await sameDelivery()) return { outcome: 'conflict' };
  if (admitted) await supersedePrevious(store, scheduler, tenant, definition, run).catch((error: unknown) => report(error, { site: 'service.supersede', tenantId: tenant, correlationId: runId }));
  await recoverWebhookDispatch(store, scheduler, tenant, runId);
  return { outcome: admitted ? 'accepted' : 'replay', runId };
}

async function admitGithub(store: WorkflowStore, scheduler: Scheduler, request: WebhookRequest): Promise<WebhookDelivery> {
  const { tenantId, definitionId } = request; const delivery = githubDelivery(request.headers ?? {});
  if (!uuid.test(tenantId ?? '') || !uuid.test(definitionId ?? '') || !delivery) return { outcome: 'invalid-shape' };
  const tenant = tenantId as string; const definition = definitionId as string;
  const published = await store.workerDefinition(tenant, definition);
  if (!published) return { outcome: 'not-found' };
  const trigger = published.definition.nodes.find((node) => node.id === published.definition.start);
  if (trigger?.config['mode'] !== 'webhook' || trigger.config['source'] !== 'github') return { outcome: 'invalid-shape' };
  const secrets = credentialSecrets(await store.workerRead<WebhookCredential>(tenant, 'webhook-credential', definition), request.fallbackSecret, request.now ?? Date.now());
  if (!secrets.length) return { outcome: 'credential-state' };
  if (!verifyGithubSignature(secrets, request.body, delivery.signature)) return { outcome: 'signature' };
  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(request.body).toString('utf8')); } catch { return { outcome: 'invalid-shape' }; }
  const mapped = mapDelivery(trigger.config, payload, delivery.event);
  if (mapped.kind === 'ignored') return { outcome: 'ignored' };
  if (mapped.kind === 'invalid') return { outcome: 'invalid-shape' };
  return admitRun(store, scheduler, tenant, definition, delivery.eventId, published, trigger, mapped.input);
}

export async function recoverWebhookDispatch(store: WorkflowStore, scheduler: Scheduler, tenantId: string, runId?: string): Promise<number> {
  const intents = runId ? [await store.workerRead<WebhookDispatch>(tenantId, 'webhook-dispatch', runId)].filter((value): value is WorkflowRecord<WebhookDispatch> => value !== undefined) : await store.workerList<WebhookDispatch>(tenantId, 'webhook-dispatch');
  let recovered = 0;
  for (const intent of intents) {
    if (intent.state !== 'pending') continue;
    try { await scheduler.start(intent.id, tenantId, intent.data.definitionId); }
    catch { continue; }
    await store.workerWrite(tenantId, 'webhook-dispatch', intent.id, intent.version, 'scheduled', intent.data);
    recovered += 1;
  }
  return recovered;
}

export async function recoverPendingWebhookDispatches(store: WorkflowStore, scheduler: Scheduler): Promise<number> {
  const pending = await store.pendingWebhookDispatches?.() ?? [];
  const recovered = await Promise.all(pending.map((item) => recoverWebhookDispatch(store, scheduler, item.tenantId, item.runId)));
  return recovered.reduce((total, value) => total + value, 0);
}
const graph = (stored: StudioStoredDraft<StudioDraft | GraphDraft>): GraphDraft => {
  const value = stored.draft as unknown as GraphDraft;
  if (value.kind !== 'graph-v1') fail('INVALID');
  return value;
};
const definitionId = (draftId: string, revision: number): string => {
  const bytes = createHash('sha256').update(`${draftId}:${revision}`).digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return `${bytes.subarray(0, 4).toString('hex')}-${bytes.subarray(4, 6).toString('hex')}-${bytes.subarray(6, 8).toString('hex')}-${bytes.subarray(8, 10).toString('hex')}-${bytes.subarray(10, 16).toString('hex')}`;
};
const reconciliationEffectKey = (key: string): string => {
  const bytes = createHash('sha256').update(`${key}:effect`).digest();
  bytes[6] = (bytes[6]! & 15) | 80; bytes[8] = (bytes[8]! & 63) | 128;
  return `${bytes.subarray(0, 4).toString('hex')}-${bytes.subarray(4, 6).toString('hex')}-${bytes.subarray(6, 8).toString('hex')}-${bytes.subarray(8, 10).toString('hex')}-${bytes.subarray(10, 16).toString('hex')}`;
};
const memoryFailure = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  if (value === 'disabled') return 'disabled';
  if (value === 'not-configured') return 'not-configured';
  if (value === 'unavailable' || value === 'provider-unavailable') return 'provider-unavailable';
  if (value === 'INVALID_PROPOSAL' || value === 'UNGROUNDED_CLAIM') return 'invalid-evidence';
  if (value === 'DUPLICATE') return 'duplicate';
  return 'provider-failed';
};

const consolidationView = (record: ConsolidationRecord | undefined): Record<string, unknown> => record ? { consolidation: { decision: record.decision, path: record.path, ...(record.targetId ? { targetId: record.targetId } : {}), corroborations: record.corroboratedBy?.length ?? 0 } } : {};

const judgmentModelIssues = (node: GraphNode, path: string, decisions: readonly OpenRouterModel[] | undefined): GraphIssue[] => {
  if (!decisions) return [{ path, code: 'OPENROUTER_CATALOG_UNAVAILABLE', message: 'OpenRouter model catalog is unavailable; try again shortly' }];
  const selected = decisions.find((item) => item.id === node.config['model']);
  if (!selected) return [{ path, code: 'JUDGMENT_MODEL_NOT_ALLOWED', message: 'select an exact decision model from the catalog' }];
  const tokens = (node.config['policy'] as { tokens?: unknown } | undefined)?.tokens;
  if (selected.contextLength !== undefined && typeof tokens === 'number' && tokens > selected.contextLength) return [{ path, code: 'JUDGMENT_CONTEXT_EXCEEDED', message: "the policy token limit is larger than this model's context window" }];
  return [];
};

export class WorkflowService {
  constructor(private readonly studio: StudioStore, private readonly store: WorkflowStore, private readonly scheduler?: Scheduler, private readonly openRouterTenants: readonly string[] = [], private readonly availableProviders: readonly string[] = ['azure-openai', 'openrouter'], private readonly connectorReady: (installation: Installation, tenantId: string) => boolean | Promise<boolean> = () => true, private readonly memoryReadiness: (tenantId: string) => MemoryReadiness = () => 'disabled', private readonly memory?: HostedMemoryPort, private readonly openRouter?: { crypto: OpenRouterConnectionCrypto; verify: (key: string) => Promise<boolean> }, private readonly openRouterCatalog?: OpenRouterCatalog) {}

  private async providerIssues(context: ExecutionContext, draft: GraphDraft): Promise<GraphIssue[]> {
    const openRouterNode = (kind: string): boolean => draft.nodes.some((node) => node.kind === kind && node.config['provider'] === 'openrouter');
    const usesOpenRouter = openRouterNode('agent') || openRouterNode('judgment');
    const connection = usesOpenRouter ? await this.store.read<OpenRouterConnection>(context, 'openrouter-connection', '00000000-0000-5000-8000-000000000002') : undefined;
    const unavailable = (error: unknown): undefined => { report(error, { site: 'service.catalog' }); return undefined; };
    let catalog: readonly OpenRouterModel[] | undefined; let decisions: readonly OpenRouterModel[] | undefined;
    if (openRouterNode('agent') && this.openRouterCatalog) catalog = await this.openRouterCatalog.chat().catch(unavailable);
    if (openRouterNode('judgment') && this.openRouterCatalog) decisions = await this.openRouterCatalog.decisions().catch(unavailable);
    const toolOwners = new Set(draft.edges.filter((edge) => edge.role === 'tool').map((edge) => edge.from));
    return draft.nodes.flatMap((node, index) => {
      if (node.kind !== 'agent' && node.kind !== 'judgment') return [];
      const path = `/nodes/${index}/config`;
      if (!this.availableProviders.includes(String(node.config['provider']))) return [{ path, code: 'PROVIDER_NOT_READY', message: 'provider not ready' }];
      if (node.config['provider'] !== 'openrouter') return [];
      if (!this.openRouter && !this.openRouterCatalog) return [];
      if (!this.openRouter || connection?.state !== 'ready' || !connection.data.enabled || !connection.data.verifiedAt) return [{ path, code: 'OPENROUTER_CONNECTION_NOT_READY', message: 'OpenRouter connection is not ready' }];
      if (node.kind === 'judgment') return judgmentModelIssues(node, path, decisions);
      if (!catalog) return [{ path, code: 'OPENROUTER_CATALOG_UNAVAILABLE', message: 'OpenRouter model catalog is unavailable; try again shortly' }];
      const selected = catalog.find((item) => item.id === node.config['model']);
      const fallback = node.config['fallback'] === undefined ? undefined : catalog.find((item) => item.id === node.config['fallback']);
      if (!selected || fallback === undefined && node.config['fallback'] !== undefined) return [{ path, code: 'OPENROUTER_MODEL_NOT_ALLOWED', message: 'select an exact OpenRouter model from the catalog' }];
      if (!selected.structuredOutput || fallback && !fallback.structuredOutput) return [{ path, code: 'OPENROUTER_STRUCTURED_OUTPUT_UNSUPPORTED', message: 'selected model does not support structured output' }];
      if (toolOwners.has(node.id) && (!selected.tools || fallback && !fallback.tools)) return [{ path, code: 'OPENROUTER_TOOLS_UNSUPPORTED', message: 'selected model does not support tool calling' }];
      return [];
    });
  }

  async openRouterConnection(context: ExecutionContext, action: 'connect' | 'rotate' | 'verify' | 'disconnect', expectedVersion: number, key: string, requestDigest: string, candidate?: string): Promise<{ version: number; state: string }> {
    await this.store.assertProfile(context, 'admin');
    const provider = this.openRouter; if (!provider) throw Object.assign(new Error('FEATURE_NOT_READY'), { code: 'FEATURE_NOT_READY' });
    const crypto = provider.crypto;
    const connectionId = '00000000-0000-5000-8000-000000000002'; const current = await this.store.read<OpenRouterConnection>(context, 'openrouter-connection', connectionId);
    if ((current?.version ?? 0) !== expectedVersion) fail('STALE');
    let data: OpenRouterConnection; let state: string;
    if (action === 'disconnect') { data = { provider: 'openrouter', enabled: false }; state = 'disabled'; }
    else {
      const secret = action === 'verify' ? current?.data.key && crypto.open(String(context.tenantId), current.data.key) : candidate;
      if (typeof secret !== 'string' || secret.length > 4096 || !await provider.verify(secret)) fail('DENIED');
      const verifiedSecret = secret as string;
      if (action === 'verify') data = { ...current!.data, verifiedAt: new Date().toISOString() };
      else data = { provider: 'openrouter', enabled: true, key: crypto.seal(String(context.tenantId), verifiedSecret), digest: crypto.digest(String(context.tenantId), verifiedSecret), verifiedAt: new Date().toISOString() };
      state = 'ready';
    }
    const result = await this.store.write(context, 'admin', 'openrouter-connection', connectionId, expectedVersion, state, data, key, requestDigest, { commandId: key, objectId: connectionId, revision: expectedVersion + 1, state, digest: await digest({ provider: data.provider, enabled: data.enabled, verifiedAt: data.verifiedAt }), evidenceIds: [] });
    return { version: result.replayed ? expectedVersion + 1 : expectedVersion + 1, state };
  }

  private async assertModelSettingsUsable(context: ExecutionContext, settings: ModelSettings): Promise<void> {
    const providers = [settings.summary?.provider, settings.embedding.provider].filter((provider) => provider !== undefined && provider !== 'upstash');
    if (providers.some((provider) => !this.availableProviders.includes(String(provider)))) fail('FEATURE_NOT_READY');
    if (providers.includes('openrouter')) {
      const connection = await this.store.read<OpenRouterConnection>(context, 'openrouter-connection', '00000000-0000-5000-8000-000000000002');
      if (!this.openRouter || !this.openRouterCatalog || connection?.state !== 'ready' || !connection.data.enabled || !connection.data.verifiedAt) fail('FEATURE_NOT_READY');
    }
    const catalog = this.openRouterCatalog;
    const listed = async (load: () => Promise<readonly OpenRouterModel[]>): Promise<readonly OpenRouterModel[]> => load().catch((error: unknown) => { report(error, { site: 'service.catalog' }); return fail('FEATURE_NOT_READY'); });
    if (settings.summary?.provider === 'openrouter' && catalog) {
      const models = await listed(() => catalog.chat());
      for (const selected of [settings.summary.model, settings.summary.fallback]) if (selected !== undefined && !models.some((item) => item.id === selected && item.structuredOutput)) fail('INVALID');
    }
    if (settings.embedding.provider === 'openrouter' && catalog && !(await listed(() => catalog.embedding())).some((item) => item.id === settings.embedding.model)) fail('INVALID');
    if (settings.embedding.provider !== 'upstash') await this.memory?.verifyEmbedding?.(String(context.tenantId), settings.embedding).catch((error: unknown) => { report(error, { site: 'service.embedding-check' }); return fail(error instanceof Error && error.message === 'INVALID_EMBEDDINGS' ? 'INVALID' : 'FEATURE_NOT_READY'); });
  }

  async configureModelSettings(context: ExecutionContext, input: unknown, expectedVersion: number, key: string, requestDigest: string): Promise<{ version: number; state: string }> {
    await this.store.assertProfile(context, 'admin');
    const settings = parseModelSettings(input);
    const current = await this.store.read<ModelSettings>(context, 'model-settings', MODEL_SETTINGS_ID);
    if ((current?.version ?? 0) !== expectedVersion) fail('STALE');
    await this.assertModelSettingsUsable(context, settings);
    await this.store.write(context, 'admin', 'model-settings', MODEL_SETTINGS_ID, expectedVersion, 'ready', settings, key, requestDigest, { commandId: key, objectId: MODEL_SETTINGS_ID, revision: expectedVersion + 1, state: 'ready', digest: await digest(settings), evidenceIds: [] });
    return { version: expectedVersion + 1, state: 'ready' };
  }

  async draft(context: ExecutionContext, draftId: string): Promise<StudioStoredDraft<StudioDraft | GraphDraft>> { return this.studio.get(context, id(draftId)); }
  async drafts(context: ExecutionContext): Promise<readonly StudioStoredDraft<StudioDraft | GraphDraft>[]> { return (await this.studio.list(context)).filter((item) => (item.draft as unknown as GraphDraft).kind === 'graph-v1'); }
  async revisions(context: ExecutionContext, draftId: string): Promise<readonly StudioStoredDraft<StudioDraft | GraphDraft>[]> { return (await this.studio.revisions(context, id(draftId))).filter((item) => (item.draft as unknown as GraphDraft).kind === 'graph-v1'); }

  async pins(context: ExecutionContext, draftId: string): Promise<CapabilityPin[]> {
    const grants = (await this.store.list<CapabilityGrant>(context, 'grant')).filter((record) => record.state === 'active' && record.data.draftId.toLowerCase() === draftId.toLowerCase());
    const installations = await this.store.list<Installation>(context, 'installation');
    const ready = new Map(await Promise.all(installations.map(async (item) => [item.id, await this.connectorReady(item.data, context.tenantId)] as const)));
    return grants.flatMap((grant) => {
      const installation = installations.find((item) => item.id.toLowerCase() === grant.data.installationId.toLowerCase() && item.state === 'healthy' && item.data.manifest.certified && item.data.manifest.digest === grant.data.manifestDigest && ready.get(item.id) === true);
      const capability = installation?.data.manifest.capabilities.find((item) => item.name === grant.data.capability);
      return installation && capability ? [{ nodeId: grant.data.nodeId, installationId: installation.id, capability: capability.name, manifestDigest: installation.data.manifest.digest, grantId: grant.id, risk: capability.risk, inputSchema: capability.inputSchema, outputSchema: capability.outputSchema, ...(capability.targetFields ? { targetFields: capability.targetFields } : {}) }] : [];
    });
  }

  async check(context: ExecutionContext, draftId: string, expectedVersion?: number): Promise<{ revision: number; digest: string; candidateDigest?: string; issues: GraphIssue[]; evidenceId: string }> {
    await this.store.assertProfile(context, 'editor');
    const stored = await this.draft(context, draftId); const pins = await this.pins(context, draftId);
    if (expectedVersion !== undefined && stored.revision !== expectedVersion) fail('STALE');
    const issues = [...validateGraph(graph(stored), pins), ...await this.providerIssues(context, graph(stored))];
    const candidate = issues.length ? undefined : await compileGraph(definitionId(draftId, stored.revision), stored.revision, graph(stored), pins);
    const evidenceId = randomUUID();
    await this.studio.appendRun(context, draftId, { id: evidenceId, revision: stored.revision, subjectDigest: stored.digest, kind: 'checks', status: issues.length ? 'failed' : 'passed', report: { classification: 'live', issues, ...(candidate ? { candidateDigest: candidate.digest } : {}) } });
    return { revision: stored.revision, digest: stored.digest, ...(candidate ? { candidateDigest: candidate.digest } : {}), issues, evidenceId };
  }

  async publish(context: ExecutionContext, draftId: string, reviewDigest: string, expectedVersion?: number): Promise<WorkflowDefinition> {
    await this.store.assertProfile(context, 'admin');
    const stored = await this.draft(context, draftId); const pins = await this.pins(context, draftId);
    if (expectedVersion !== undefined && stored.revision !== expectedVersion) fail('STALE');
    if ((await this.providerIssues(context, graph(stored))).length > 0) fail('FEATURE_NOT_READY');
    const definition = await compileGraph(definitionId(draftId, stored.revision), stored.revision, graph(stored), pins);
    if (reviewDigest !== definition.digest) fail('STALE');
    await this.store.publish(context, definition, draftId, stored.revision, stored.digest, reviewDigest);
    return definition;
  }

  async start(context: ExecutionContext, publishedId: string, input: Record<string, unknown>, key: string, requestDigest: string): Promise<{ runId: string; replayed: boolean; digest: string }> {
    const scheduler = this.scheduler; if (!scheduler) throw Object.assign(new Error('FEATURE_NOT_READY'), { code: 'FEATURE_NOT_READY' });
    await this.store.assertProfile(context, 'operator');
    const published = (await this.store.definitions(context, id(publishedId)))[0] ?? fail('NOT_FOUND');
    const trigger = published.definition.nodes.find((node) => node.id === published.definition.start)!;
    if (trigger.config['mode'] !== 'manual' || !validateValue(input, trigger.config['inputSchema'] as JsonSchema)) fail('INVALID');
    const runId = id(key); const inputDigest = await digest(input);
    const label = labelOf(trigger.config, input);
    const run: WorkflowRun = { ...(label ? { label } : {}), id: runId, tenantId: String(context.tenantId), ownerId: context.userId, stableDefinitionId: published.draftId, definitionId: published.id, definitionRevision: published.draftRevision, definitionDigest: published.digest, inputDigest, input, status: 'queued', history: [], outputs: {}, summaryStatus: 'pending' };
    const receipt = { commandId: key, objectId: runId, revision: 1, state: 'queued', digest: published.digest, evidenceIds: [] };
    const result = await this.store.write(context, 'operator', 'run', runId, 0, 'queued', run, key, requestDigest, receipt);
    if (!result.replayed) runStarted(String(context.tenantId), runId, published.id, 'manual', context.userId);
    await scheduler.start(runId, String(context.tenantId), published.id);
    return { runId, replayed: result.replayed, digest: published.digest };
  }

  async approve(context: ExecutionContext, runId: string, bindingDigest: string, decision: 'approve' | 'reject', expectedVersion: number, key: string, requestDigest: string, reason?: string): Promise<void> {
    const scheduler = this.scheduler; if (!scheduler) throw Object.assign(new Error('FEATURE_NOT_READY'), { code: 'FEATURE_NOT_READY' });
    if (reason !== undefined && (typeof reason !== 'string' || reason.length > REASON_LIMIT)) fail('INVALID');
    await this.store.assertProfile(context, 'admin');
    const current = await this.store.read<WorkflowRun>(context, 'run', id(runId));
    if (current?.data.history.some((item) => item.kind === 'approval' && item.bindingDigest === bindingDigest && item.detail === decision)) { await scheduler.raise(runId, 'approval', { bindingDigest, decision }); return; }
    if (!current || current.version !== expectedVersion || current.data.status !== 'waiting-approval' || !current.data.waiting || current.data.waiting.bindingDigest !== bindingDigest || Date.parse(current.data.waiting.expiresAt) <= Date.now()) throw Object.assign(new Error('STALE'), { code: 'STALE' });
    const waiting = current.data.waiting; const decidedAt = new Date().toISOString();
    const gate = (await this.store.definitions(context, current.data.definitionId))[0]?.definition.nodes.find((node) => node.id === waiting.nodeId);
    if (gate?.config['separationOfDuties'] === true && current.data.ownerId === context.userId) throw Object.assign(new Error('DENIED'), { code: 'DENIED' });
    const record: DecisionRecord = { outcome: decision, ...(reason ? { reason } : {}), approverId: context.userId, decidedAt, bindingDigest, ...(waiting.review ? { argumentsDigest: waiting.review.argumentsDigest } : {}), facts: waiting.review?.facts ?? [] };
    const updated = { ...current.data, decisions: { ...current.data.decisions, [waiting.nodeId]: record }, history: [...current.data.history, { nodeId: waiting.nodeId, kind: 'approval', state: decision === 'approve' ? 'completed' : 'rejected', at: decidedAt, detail: decision, bindingDigest } satisfies RunEvent] };
    delete updated.waiting;
    const settled: WorkflowRun = { ...updated, status: decision === 'approve' ? 'running' : 'rejected' };
    await this.store.write(context, 'admin', 'run', runId, current.version, settled.status, settled, key, requestDigest, { commandId: key, objectId: runId, revision: current.version + 1, state: decision, digest: bindingDigest, evidenceIds: [] });
    approvalDecided(String(context.tenantId), runId, decision, context.userId, waiting.requestedAt);
    if (decision === 'reject') runFinished(String(context.tenantId), settled, 'rejected', 'REJECTED');
    await scheduler.raise(runId, 'approval', { bindingDigest, decision });
  }

  async cancel(context: ExecutionContext, runId: string, expectedVersion: number, key: string, requestDigest: string): Promise<void> {
    const scheduler = this.scheduler; if (!scheduler) throw Object.assign(new Error('FEATURE_NOT_READY'), { code: 'FEATURE_NOT_READY' });
    await this.store.assertProfile(context, 'operator');
    const current = await this.store.read<WorkflowRun>(context, 'run', id(runId));
    if (current?.data.status === 'cancelled') return;
    if (!current || current.version !== expectedVersion || !['queued', 'running', 'waiting-approval'].includes(current.data.status)) throw Object.assign(new Error('STALE'), { code: 'STALE' });
    if (current.data.ownerId !== context.userId) await this.store.assertProfile(context, 'admin');
    const waiting = current.data.waiting;
    const updated = { ...current.data, history: [...current.data.history, { nodeId: waiting?.nodeId ?? current.data.history.at(-1)?.nodeId ?? 'run', kind: 'cancel', state: 'cancelled', at: new Date().toISOString(), detail: 'CANCELLED' } satisfies RunEvent] };
    delete updated.waiting;
    const settled: WorkflowRun = { ...updated, status: 'cancelled' };
    await this.store.write(context, 'operator', 'run', runId, current.version, 'cancelled', settled, key, requestDigest, { commandId: key, objectId: runId, revision: current.version + 1, state: 'cancelled', digest: current.data.definitionDigest, evidenceIds: [] });
    runFinished(String(context.tenantId), settled, 'cancelled', 'CANCELLED');
    if (waiting) await scheduler.raise(runId, 'approval', { bindingDigest: waiting.bindingDigest, decision: 'cancel' });
  }

  async reconcile(context: ExecutionContext, runId: string, disposition: 'adopt' | 'no-effect', expectedVersion: number, key: string, requestDigest: string): Promise<Record<string, unknown>> {
    await this.store.assertProfile(context, 'admin');
    const run = await this.store.read<WorkflowRun>(context, 'run', id(runId)) ?? fail('STALE');
    if (run.state !== 'unknown-outcome' || run.version !== expectedVersion) fail('STALE');
    const history = await this.store.runHistory(context, 1, undefined, runId);
    const unresolved = (history.effects as readonly WorkflowRecord<EffectData>[]).filter((effect) => effect.data.runId === runId && ['possible-send', 'unknown-outcome'].includes(effect.state));
    if (unresolved.length !== 1) fail('STALE');
    const effect = unresolved[0] ?? fail('STALE');
    const effectState = disposition === 'adopt' ? 'succeeded' : 'failed';
    const effectData: EffectData = { ...effect.data, state: effectState };
    const runData: WorkflowRun = { ...run.data, status: 'failed', history: [...run.data.history, { nodeId: effect.data.nodeId, kind: 'reconciliation', state: 'failed', at: new Date().toISOString(), detail: disposition, receiptId: effect.id }] };
    const receipt = { commandId: key, objectId: runId, revision: run.version + 1, state: 'failed', digest: await digest(runData.history), evidenceIds: [] };
    return this.store.reconcile(context, {
      run, effect, runData, effectData, key, effectKey: reconciliationEffectKey(key), requestDigest,
      receipt,
      effectReceipt: { commandId: key, objectId: effect.id, revision: effect.version + 1, state: disposition, digest: effect.data.requestDigest, evidenceIds: [] },
    });
  }

  async grant(context: ExecutionContext, draftId: string, nodeId: string, installationId: string, capability: string, key: string, requestDigest: string): Promise<void> {
    await this.store.assertProfile(context, 'admin');
    const draft = graph(await this.draft(context, id(draftId)));
    if (!draft.nodes.some((node) => node.id === nodeId && node.kind === 'mcp')) fail('INVALID');
    const installation = await this.store.read<Installation>(context, 'installation', id(installationId));
    if (!installation || installation.state !== 'healthy' || !await this.connectorReady(installation.data, context.tenantId) || !installation.data.manifest.certified || !installation.data.manifest.capabilities.some((item) => item.name === capability)) throw Object.assign(new Error('DENIED'), { code: 'DENIED' });
    const data: CapabilityGrant = { draftId: id(draftId), nodeId, installationId, capability, manifestDigest: installation.data.manifest.digest };
    await this.store.write(context, 'admin', 'grant', id(key), 0, 'active', data, key, requestDigest, { commandId: key, objectId: key, revision: 1, state: 'active', digest: data.manifestDigest, evidenceIds: [] });
  }

  async webhookCredential(context: ExecutionContext, definitionId: string, action: 'provision' | 'rotate' | 'disable', expectedVersion: number, key: string, requestDigest: string): Promise<string | undefined> {
    await this.store.assertProfile(context, 'admin');
    const published = (await this.store.definitions(context, id(definitionId)))[0];
    if (!published || published.definition.nodes.find((node) => node.id === published.definition.start)?.config['mode'] !== 'webhook') fail('INVALID');
    const current = await this.store.read<WebhookCredential>(context, 'webhook-credential', definitionId);
    if ((current?.version ?? 0) !== expectedVersion || action === 'provision' && current) fail('STALE');
    const secret = action === 'disable' ? undefined : randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    const data: WebhookCredential = action === 'disable'
      ? { ...current!.data, enabled: false, rotatedAt: now }
      : {
        definitionId,
        secret: secret!,
        enabled: true,
        rotatedAt: now,
        ...(action === 'rotate' && current?.data.enabled
          ? { previousSecret: current.data.secret, previousExpiresAt: new Date(Date.now() + 300000).toISOString() }
          : {}),
      };
    const state = data.enabled ? 'active' : 'disabled';
    const receipt = { commandId: key, objectId: definitionId, revision: expectedVersion + 1, state, digest: await digest({ definitionId, enabled: data.enabled, rotatedAt: data.rotatedAt }), evidenceIds: [] };
    const result = await this.store.write(context, 'admin', 'webhook-credential', definitionId, expectedVersion, state, data, key, requestDigest, receipt);
    return result.replayed ? undefined : secret;
  }

  async testWebhook(context: ExecutionContext, definitionId: string, input: Record<string, unknown>): Promise<WebhookDelivery> {
    const scheduler = this.scheduler ?? fail('FEATURE_NOT_READY');
    await this.store.assertProfile(context, 'admin');
    const tenantId = String(context.tenantId); const idValue = id(definitionId);
    const credential = await this.store.read<WebhookCredential>(context, 'webhook-credential', idValue);
    if (!credential || credential.state !== 'active' || !credential.data.enabled) return { outcome: 'credential-state' };
    const eventId = randomUUID(); const timestamp = new Date().toISOString(); const body = Buffer.from(JSON.stringify(input));
    const signature = `sha256=${createHmac('sha256', credential.data.secret).update(webhookMessage(tenantId, idValue, timestamp, eventId, body)).digest('hex')}`;
    return deliverWebhook(this.store, scheduler, { tenantId, definitionId: idValue, eventId, timestamp, signature, body });
  }

  async importMemory(context: ExecutionContext, targetDefinitionId: string, sourceDefinitionId: string, key: string, requestDigest: string): Promise<void> {
    await this.store.assertProfile(context, 'admin');
    const target = (await this.store.definitions(context, id(targetDefinitionId)))[0];
    const source = (await this.store.definitions(context)).find((item) => item.draftId === id(sourceDefinitionId));
    if (!target || !source || source.draftId === target.draftId) return fail('INVALID');
    const data: MemoryImport = { targetDefinitionId: target.id, targetRevision: target.draftRevision, sourceDefinitionId: source.draftId, state: 'active', actorId: context.userId, requestId: key };
    await this.store.write(context, 'admin', 'memory-import', id(key), 0, 'active', data, key, requestDigest, { commandId: key, objectId: key, revision: 1, state: 'active', digest: await digest(data), evidenceIds: [] });
  }

  async revokeMemoryImport(context: ExecutionContext, importId: string, expectedVersion: number, reason: string, key: string, requestDigest: string): Promise<void> {
    await this.store.assertProfile(context, 'admin');
    const current = await this.store.read<MemoryImport>(context, 'memory-import', id(importId));
    if (!current || current.version !== expectedVersion || current.state !== 'active') return fail('STALE');
    const data: MemoryImport = { ...current.data, state: 'revoked', reason, revokedAt: new Date().toISOString() };
    await this.store.write(context, 'admin', 'memory-import', current.id, current.version, 'revoked', data, key, requestDigest, { commandId: key, objectId: current.id, revision: current.version + 1, state: 'revoked', digest: await digest(data), evidenceIds: [] });
  }

  async memoryLifecycle(context: ExecutionContext, action: 'withdraw' | 'hold' | 'release-hold' | 'set-expiry' | 'delete', itemId: string, expectedVersion: number, key: string, requestDigest: string, reason?: string, expiresAt?: string): Promise<void> {
    await this.store.assertProfile(context, 'admin');
    const current = await this.store.read<MemoryItem>(context, 'memory-item', id(itemId));
    if (!current || current.version !== expectedVersion) return fail('STALE');
    if (action === 'delete' && current.data.hold) return fail('DENIED');
    if (action === 'set-expiry' && (!expiresAt || !current.data.expiresAt || Number.isNaN(Date.parse(expiresAt)) || Number.isNaN(Date.parse(current.data.expiresAt)) || new Date(expiresAt).toISOString() !== expiresAt || Date.parse(expiresAt) > Date.parse(current.data.expiresAt) || Date.parse(expiresAt) > maxMemoryExpiry(current.data.type))) return fail('INVALID');
    const state = action === 'withdraw' ? 'withdrawn' : action === 'delete' ? 'delete-requested' : current.state;
    const data: MemoryItem = { ...current.data, ...(action === 'hold' ? { hold: true } : {}), ...(action === 'release-hold' ? { hold: false } : {}), ...(action === 'set-expiry' && expiresAt ? { expiresAt } : {}), ...(action === 'delete' || action === 'withdraw' ? { vectorState: 'remove-pending' } : {}) };
    const receiptId = id(key);
    await this.store.write(context, 'admin', 'memory-item', current.id, current.version, state, data, key, requestDigest, { commandId: key, objectId: current.id, revision: current.version + 1, state, digest: await digest({ action, itemId: current.id, ...(reason ? { reason } : {}), ...(expiresAt ? { expiresAt } : {}) }), evidenceIds: [receiptId] });
    await this.store.workerWrite(String(context.tenantId), 'memory-lifecycle', receiptId, 0, action, { itemId: current.id, actorId: context.userId, requestId: key, ...(reason ? { reason } : {}), ...(expiresAt ? { expiresAt } : {}), at: new Date().toISOString() });
    if (data.vectorState === 'remove-pending') await this.scheduler?.removeMemory?.(current.id, String(context.tenantId));
  }

  async correctMemory(context: ExecutionContext, itemId: string, text: string, expectedVersion: number, key: string, requestDigest: string): Promise<void> {
    await this.store.assertProfile(context, 'admin');
    const current = await this.store.read<MemoryItem>(context, 'memory-item', id(itemId));
    const memory = this.memory; const tenantId = String(context.tenantId);
    if (!current || current.version !== expectedVersion) return fail('STALE');
    if (!memory || !memory.enabled(tenantId) || memory.readiness !== 'ready' || text.length === 0 || text.length > 1000 || redacted(text) !== text) return fail('INVALID');
    const fingerprint = await memoryFingerprint({ tenantId, stableDefinitionId: current.data.stableDefinitionId }, { type: current.data.type === 'run-summary' ? 'task-fact' : current.data.type, sourceId: current.data.sourceId, sourceDigest: current.data.sourceDigest, ...(current.data.ownerId ? { subject: current.data.ownerId } : {}), text });
    const successorId = memoryItemId(fingerprint); const existing = await this.store.read<MemoryItem>(context, 'memory-item', successorId);
    if (!existing) {
      const expiresAt = current.data.expiresAt ?? memoryExpiry(current.data.type);
      const data: MemoryItem = { ...current.data, type: current.data.type === 'run-summary' ? 'task-fact' : current.data.type, fingerprint, predecessorId: current.id, expiresAt, vectorState: 'pending' };
      await this.store.write(context, 'admin', 'memory-item', successorId, 0, 'pending', data, id(key), requestDigest, { commandId: key, objectId: successorId, revision: 1, state: 'pending', digest: await digest(data), evidenceIds: [current.id] });
    }
    const withdrawn: MemoryItem = { ...current.data, supersededBy: successorId, vectorState: 'remove-pending' };
    await this.store.write(context, 'admin', 'memory-item', current.id, current.version, 'withdrawn', withdrawn, memoryItemId(`withdraw:${key}`), requestDigest, { commandId: key, objectId: current.id, revision: current.version + 1, state: 'withdrawn', digest: await digest(withdrawn), evidenceIds: [successorId] });
    await this.scheduler?.correctMemory?.(successorId, tenantId, text);
    await this.scheduler?.removeMemory?.(current.id, tenantId);
  }

  async invalidateMemorySource(context: ExecutionContext, sourceId: string, key: string, requestDigest: string): Promise<void> {
    await this.store.assertProfile(context, 'admin');
    if (!['input:', 'event:', 'summary:', 'tool:', 'output:'].some((prefix) => sourceId.startsWith(prefix))) return fail('INVALID');
    for (const current of await this.store.list<MemoryItem>(context, 'memory-item')) {
      if (current.data.sourceId !== sourceId || ['withdrawn', 'deleted', 'delete-requested'].includes(current.state)) continue;
      const data: MemoryItem = { ...current.data, vectorState: 'remove-pending' };
      await this.store.write(context, 'admin', 'memory-item', current.id, current.version, 'withdrawn', data, memoryItemId(`invalidate:${key}:${current.id}`), requestDigest, { commandId: key, objectId: current.id, revision: current.version + 1, state: 'withdrawn', digest: await digest(data), evidenceIds: [] });
      await this.scheduler?.removeMemory?.(current.id, String(context.tenantId));
    }
  }

  async certify(context: ExecutionContext, installationId: string, installation: Installation, expectedVersion: number, key: string, requestDigest: string): Promise<void> {
    await this.store.assertProfile(context, 'admin');
    const manifest = installation.manifest;
    if (!['public', 'private'].includes(installation.route) || !['healthy', 'offline'].includes(installation.health) || !manifest || Object.keys(manifest).some((field) => !['digest', 'version', 'certified', 'capabilities'].includes(field)) || manifest.certified !== true || typeof manifest.version !== 'string' || !manifest.version || !Array.isArray(manifest.capabilities) || !manifest.capabilities.length || manifest.capabilities.some((item) => !item || Object.keys(item).some((field) => !['name', 'risk', 'inputSchema', 'outputSchema', 'tool', 'fixed', 'targetFields'].includes(field)) || !variantValid(item) || typeof item.name !== 'string' || !item.name || !['R1', 'R2', 'R3'].includes(item.risk) || !validateSchema(item.inputSchema) || !validateSchema(item.outputSchema)) || new Set(manifest.capabilities.map((item) => item.name)).size !== manifest.capabilities.length) fail('INVALID');
    if (installation.route === 'public') { try { const endpoint = new URL(installation.endpoint ?? ''); if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) fail('INVALID'); } catch { fail('INVALID'); } }
    const actualDigest = await digest({ version: installation.manifest.version, capabilities: installation.manifest.capabilities });
    if (installation.manifest.digest !== actualDigest) fail('INVALID');
    const current = await this.store.read<Installation>(context, 'installation', installationId);
    if (current && (current.state === 'revoked' || current.data.route !== installation.route || current.data.endpoint !== installation.endpoint || current.data.manifest.digest !== actualDigest)) fail('CONFLICT');
    installation = { ...installation, id: installationId, ...(installation.route === 'private' ? { health: current?.data.health ?? 'offline' as const, ...(current?.data.tokenHash ? { tokenHash: current.data.tokenHash } : {}) } : {}) };
    await this.store.write(context, 'admin', 'installation', id(installationId), expectedVersion, installation.health, installation, key, requestDigest, { commandId: key, objectId: installationId, revision: expectedVersion + 1, state: installation.health, digest: installation.manifest.digest, evidenceIds: [] });
  }

  async retire(context: ExecutionContext, installationId: string, expectedVersion: number, key: string, requestDigest: string): Promise<void> {
    await this.store.assertProfile(context, 'admin');
    const current = await this.store.read<Installation>(context, 'installation', id(installationId));
    if (!current || current.version !== expectedVersion || current.state === 'revoked') throw Object.assign(new Error('STALE'), { code: 'STALE' });
    const data: Installation = { ...current.data, health: 'revoked' };
    delete data.tokenHash;
    await this.store.write(context, 'admin', 'installation', installationId, expectedVersion, 'revoked', data, key, requestDigest, { commandId: key, objectId: installationId, revision: expectedVersion + 1, state: 'revoked', digest: data.manifest.digest, evidenceIds: [] });
  }

  async token(context: ExecutionContext, installationId: string, expectedVersion: number, action: 'enroll' | 'rotate' | 'revoke', key: string, requestDigest: string): Promise<string | undefined> {
    await this.store.assertProfile(context, 'admin');
    const current = await this.store.read<Installation>(context, 'installation', id(installationId));
    if (!current || current.version !== expectedVersion || current.data.route !== 'private') throw Object.assign(new Error('STALE'), { code: 'STALE' });
    const token = action === 'revoke' ? undefined : randomBytes(32).toString('base64url');
    const data: Installation = { ...current.data, health: action === 'revoke' ? 'revoked' : 'offline' };
    delete data.tokenHash;
    if (token) data.tokenHash = createHash('sha256').update(token).digest('hex');
    const result = await this.store.write(context, 'admin', 'installation', installationId, expectedVersion, data.health, data, key, requestDigest, { commandId: key, objectId: installationId, revision: expectedVersion + 1, state: data.health, digest: data.manifest.digest, evidenceIds: [] });
    return result.replayed ? undefined : token;
  }

  async projection(context: ExecutionContext, collection: string, recordId?: string, query?: { pageSize?: number; cursor?: string }): Promise<Record<string, unknown>> {
    const tenantId = String(context.tenantId);
    let records: Record<string, unknown>[] = [];
    if (collection === 'workflow-drafts') records = (await this.drafts(context)).map((item) => ({ id: item.id, revision: item.revision, digest: item.digest, state: item.state, graph: item.draft }));
    else if (collection === 'workflow-revisions') { const draftId = id(recordId); records = (await this.revisions(context, draftId)).map((item) => ({ id: draftId, revision: item.revision, digest: item.digest, state: item.state, createdAt: item.createdAt, graph: item.draft })); }
    else if (collection === 'workflow-definitions') records = (await this.store.definitions(context, recordId)).map((item) => ({ id: item.id, draftId: item.draftId, revision: item.draftRevision, digest: item.digest, nodes: item.definition.nodes.map((node) => ({ id: node.id, kind: node.kind, next: node.next, ...(node.tools ? { tools: node.tools } : {}), ...(node.tool ? { tool: true } : {}) })), capabilityPins: item.definition.capabilityPins.map((pin) => ({ capability: pin.capability, risk: pin.risk, manifestDigest: pin.manifestDigest })) }));
    else if (collection === 'workflow-runs') {
      const pageSize = query?.pageSize ?? 50;
      if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) fail('INVALID');
      const cursor = query?.cursor === undefined ? undefined : decodeRunHistoryCursor(query.cursor, tenantId);
      const page = await this.store.runHistory(context, pageSize, cursor, recordId);
      const effects = new Map<string, WorkflowRecord<{ runId: string; nodeId: string; requestDigest: string; argumentsDigest: string }>[]>()
      for (const effect of page.effects as readonly WorkflowRecord<{ runId: string; nodeId: string; requestDigest: string; argumentsDigest: string }>[]) effects.set(effect.data.runId, [...effects.get(effect.data.runId) ?? [], effect]);
      const retrievals = new Map<string, WorkflowRecord<{ runId: string; nodeId: string; status: string; itemIds: readonly string[]; importIds: readonly string[]; rank?: readonly Record<string, number | string>[]; failure?: string }>[]>()
      for (const retrieval of page.retrievals as readonly WorkflowRecord<{ runId: string; nodeId: string; status: string; itemIds: readonly string[]; importIds: readonly string[]; rank?: readonly Record<string, number | string>[]; failure?: string }>[]) retrievals.set(retrieval.data.runId, [...retrievals.get(retrieval.data.runId) ?? [], retrieval]);
      records = page.runs.map((item) => {
        const run = item.data as unknown as WorkflowRun;
        return { id: item.id, version: item.version, status: run.status, definitionId: run.definitionId, stableDefinitionId: run.stableDefinitionId, definitionRevision: run.definitionRevision, definitionDigest: run.definitionDigest, inputDigest: run.inputDigest, inputSummary: Object.entries(run.input).map(([field, value]) => ({ field, type: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value })), history: run.history, effects: (effects.get(item.id) ?? []).map((effect) => ({ id: effect.id, nodeId: effect.data.nodeId, state: effect.state, requestDigest: effect.data.requestDigest, argumentsDigest: effect.data.argumentsDigest })), retrievals: (retrievals.get(item.id) ?? []).map((entry) => ({ id: entry.id, nodeId: entry.data.nodeId, status: entry.data.status, itemIds: entry.data.itemIds, importIds: entry.data.importIds, ...(entry.data.rank ? { rank: entry.data.rank } : {}), ...(memoryFailure(entry.data.failure) ? { failure: memoryFailure(entry.data.failure) } : {}) })), ...(run.waiting ? { waiting: run.waiting } : {}), ...(run.decisions ? { decisions: run.decisions } : {}), ...(run.label ? { label: run.label } : {}), ...(run.usage ? { usage: run.usage } : {}), ...(run.summaryStatus ? { summaryStatus: run.summaryStatus } : {}) };
      });
      const last = page.runs.at(-1);
      if (page.hasMore && last !== undefined) return { tenantId, collection, records, completeness: 'partial', classification: 'restricted-operational', freshness: 'current', redaction: 'applied', continuation: { cursor: runHistoryCursor(tenantId, { createdAt: last.createdAt, id: last.id }) } };
    }
    else if (collection === 'connector-installations') records = (await this.store.list<Installation>(context, 'installation')).map((item) => ({ id: item.id, version: item.version, state: item.state, route: item.data.route, health: item.data.health, manifest: item.data.manifest }));
    else if (collection === 'workflow-grants') records = (await this.store.list<CapabilityGrant>(context, 'grant')).map((item) => ({ id: item.id, version: item.version, state: item.state, ...item.data }));
    else if (collection === 'workflow-webhook-credentials') records = (await this.store.list<WebhookCredential>(context, 'webhook-credential')).map((item) => ({ id: item.id, version: item.version, state: item.state, definitionId: item.data.definitionId, enabled: item.data.enabled, rotatedAt: item.data.rotatedAt, ...(item.data.previousExpiresAt ? { previousExpiresAt: item.data.previousExpiresAt } : {}) }));
    else if (collection === 'openrouter-connections') records = (await this.store.list<OpenRouterConnection>(context, 'openrouter-connection')).map((item) => ({ id: item.id, version: item.version, state: item.state, provider: item.data.provider, enabled: item.data.enabled, ...(item.data.verifiedAt ? { verifiedAt: item.data.verifiedAt } : {}) }));
    else if (collection === 'openrouter-models') {
      const catalog = this.openRouterCatalog; const failed = (error: unknown): undefined => { report(error, { site: 'service.catalog' }); return undefined; };
      const [models, embeddingModels, decisionModels] = catalog ? await Promise.all([catalog.chat().catch(failed), catalog.embedding().catch(failed), catalog.decisions().catch(failed)]) : [undefined, undefined, undefined];
      records = [{ id: '00000000-0000-5000-8000-000000000003', provider: 'openrouter', models: models ?? [], embeddingModels: embeddingModels ?? [], decisionModels: decisionModels ?? [], catalog: models ? 'ready' : 'unavailable', configured: this.openRouter !== undefined && models !== undefined }];
    }
    else if (collection === 'workflow-model-settings') {
      const stored = await this.store.list<ModelSettings>(context, 'model-settings');
      records = stored.length ? stored.map((item) => ({ id: item.id, version: item.version, state: item.state, providers: [...this.availableProviders], ...item.data })) : [{ id: MODEL_SETTINGS_ID, version: 0, state: 'default', providers: [...this.availableProviders], ...DEFAULT_MODEL_SETTINGS }];
    }
    else if (collection === 'workflow-memory-imports') records = (await this.store.list<MemoryImport>(context, 'memory-import')).map((item) => ({ id: item.id, version: item.version, ...item.data }));
    else if (collection === 'workflow-memory-items') {
      const decisions = new Map((await this.store.list<ConsolidationRecord>(context, 'memory-consolidation')).map((entry) => [entry.id, entry.data]));
      records = (await this.store.list<MemoryItem>(context, 'memory-item')).map((item) => ({ id: item.id, version: item.version, state: item.state, stableDefinitionId: item.data.stableDefinitionId, definitionId: item.data.definitionId, producingRevision: item.data.producingRevision, type: item.data.type, sourceId: item.data.sourceId, sourceDigest: item.data.sourceDigest, ownerScoped: item.data.ownerId !== undefined, ...(item.data.predecessorId ? { predecessorId: item.data.predecessorId } : {}), ...(item.data.promotedAt ? { promotedAt: item.data.promotedAt } : {}), ...(item.data.expiresAt ? { expiresAt: item.data.expiresAt } : {}), hold: item.data.hold === true, ...(memoryFailure(item.data.failure) ? { failure: memoryFailure(item.data.failure) } : {}), ...(item.data.subjects?.length ? { subjects: item.data.subjects } : {}), ...(item.data.observedAt ? { observedAt: item.data.observedAt } : {}), ...(item.data.supersededBy ? { supersededBy: item.data.supersededBy } : {}), ...(item.data.schemaVersion ? { schemaVersion: item.data.schemaVersion } : {}), ...consolidationView(decisions.get(item.id)), vectorState: item.data.vectorState }));
    }
    else if (collection === 'workflow-memory-readiness') { const state = this.memoryReadiness(tenantId); records = [{ id: '00000000-0000-5000-8000-000000000001', state, enabled: state === 'ready', provider: 'upstash-vector' }]; }
    else fail('INVALID');
    if (recordId) records = records.filter((item) => item['id'] === recordId);
    return { tenantId, collection, records, completeness: ['workflow-runs', 'workflow-definitions', 'connector-installations'].includes(collection) ? 'partial' : 'full', classification: 'restricted-operational', freshness: 'current', redaction: 'applied' };
  }
}
