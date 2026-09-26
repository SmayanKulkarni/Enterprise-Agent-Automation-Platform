import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { digest } from '../../contracts/src/index.js';
import type { ExecutionContext } from '../../identity/src/index.js';
import type { StudioStore, StudioStoredDraft } from '../../lifecycle/src/studio-sql.js';
import type { StudioDraft } from '../../lifecycle/src/studio.js';
import { compileGraph, validateGraph, validateSchema, validateValue, type CapabilityPin, type GraphDraft, type GraphIssue, type JsonSchema, type WorkflowDefinition } from './graph.js';
import { memoryFingerprint, memoryItemId, redacted, type HostedMemoryPort, type MemoryImport, type MemoryItem } from './memory.js';
import type { WorkflowRecord, WorkflowStore } from './sql.js';
import { OpenRouterConnectionCrypto, type OpenRouterConnection } from './openrouter-connection.js';

export interface CapabilityManifest { digest: string; version: string; certified: boolean; capabilities: readonly { name: string; risk: 'R1' | 'R2' | 'R3'; inputSchema: JsonSchema; outputSchema: JsonSchema }[]; }
export interface Installation { id: string; route: 'public' | 'private'; endpoint?: string; tokenHash?: string; health: 'healthy' | 'offline' | 'revoked'; manifest: CapabilityManifest; }
export interface CapabilityGrant { draftId: string; nodeId: string; installationId: string; capability: string; manifestDigest: string; }
export interface WebhookCredential { definitionId: string; secret: string; enabled: boolean; rotatedAt: string; previousSecret?: string; previousExpiresAt?: string; }
interface WebhookDispatch { definitionId: string; }
export interface RunEvent { nodeId: string; kind: string; state: 'attempted' | 'completed' | 'waiting' | 'failed' | 'unknown-outcome'; at: string; detail?: string; receiptId?: string; bindingDigest?: string; }
export interface WorkflowRun { id: string; tenantId: string; ownerId: string; stableDefinitionId: string; definitionId: string; definitionRevision: number; definitionDigest: string; inputDigest: string; input: Record<string, unknown>; status: 'queued' | 'running' | 'waiting-approval' | 'waiting-connector' | 'unknown-outcome' | 'failed' | 'completed'; history: RunEvent[]; outputs: Record<string, Record<string, unknown>>; nodeDeadlines?: Record<string, string>; waiting?: { nodeId: string; bindingDigest: string; expiresAt: string; review?: { revision: number; installationId: string; capability: string; target: string; argumentsDigest: string; arguments: readonly { name: string; type: string }[] } }; summaryStatus?: 'pending' | 'ready' | 'failed' | 'disabled' | 'unavailable'; }
export interface Scheduler { start(runId: string, tenantId: string, definitionId: string): Promise<void>; raise(runId: string, name: string, value: unknown): Promise<void>; promoteMemory?(runId: string, tenantId: string): Promise<void>; correctMemory?(itemId: string, tenantId: string, text: string): Promise<void>; removeMemory?(itemId: string, tenantId: string): Promise<void>; }
export type WebhookDeliveryOutcome = 'accepted' | 'invalid-shape' | 'signature' | 'freshness' | 'replay' | 'credential-state' | 'not-found';
export interface WebhookDelivery { outcome: WebhookDeliveryOutcome; runId?: string; }
type MemoryReadiness = 'disabled' | 'not-configured' | 'ready' | 'unavailable';

const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const id = (value: unknown): string => typeof value === 'string' && uuid.test(value) ? value : fail('INVALID');
const webhookMessage = (tenantId: string, definitionId: string, timestamp: string, eventId: string, body: Uint8Array): Buffer => Buffer.concat([Buffer.from(`${tenantId}:${definitionId}:${timestamp}:${eventId}:`), Buffer.from(body)]);
const credentialSecrets = (credential: WorkflowRecord<WebhookCredential> | undefined, fallback: string | undefined, now: number): readonly string[] => {
  if (!credential) return fallback ? [fallback] : [];
  if (credential.state !== 'active' || !credential.data.enabled) return [];
  return [credential.data.secret, ...(credential.data.previousSecret && credential.data.previousExpiresAt && Date.parse(credential.data.previousExpiresAt) > now ? [credential.data.previousSecret] : [])];
};

export async function deliverWebhook(store: WorkflowStore, scheduler: Scheduler, request: { tenantId: string | undefined; definitionId: string | undefined; eventId: string | undefined; timestamp: string | undefined; signature: string | undefined; body: Uint8Array; fallbackSecret?: string; now?: number }): Promise<WebhookDelivery> {
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
  const run: WorkflowRun = { id: event, tenantId: tenant, ownerId: `webhook:${definition}`, stableDefinitionId: published.draftId, definitionId: definition, definitionRevision: published.draftRevision, definitionDigest: published.digest, inputDigest: await digest(input), input: input as Record<string, unknown>, status: 'queued', history: [], outputs: {}, summaryStatus: 'pending' };
  let admitted: boolean;
  try { admitted = store.admitWebhookRun ? await store.admitWebhookRun(tenant, event, definition, run.inputDigest, run) : (await store.workerWrite(tenant, 'run', event, 0, 'queued', run), await store.workerWrite(tenant, 'webhook-dispatch', event, 0, 'pending', { definitionId: definition }), true); }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'STALE')) throw error;
    const previous = await store.workerRead<WorkflowRun>(tenant, 'run', event);
    if (!previous || previous.data.definitionId !== definition || previous.data.inputDigest !== run.inputDigest) return { outcome: 'replay' };
    admitted = false;
  }
  if (!admitted) {
    const previous = await store.workerRead<WorkflowRun>(tenant, 'run', event);
    if (!previous || previous.data.definitionId !== definition || previous.data.inputDigest !== run.inputDigest) return { outcome: 'replay' };
  }
  await recoverWebhookDispatch(store, scheduler, tenant, event);
  return { outcome: admitted ? 'accepted' : 'replay', runId: event };
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
const memoryFailure = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  if (value === 'disabled') return 'disabled';
  if (value === 'not-configured') return 'not-configured';
  if (value === 'unavailable' || value === 'provider-unavailable') return 'provider-unavailable';
  if (value === 'INVALID_PROPOSAL') return 'invalid-evidence';
  return 'provider-failed';
};

export class WorkflowService {
  constructor(private readonly studio: StudioStore, private readonly store: WorkflowStore, private readonly scheduler?: Scheduler, private readonly openRouterTenants: readonly string[] = [], private readonly availableProviders: readonly string[] = ['azure-openai', 'openrouter'], private readonly connectorReady: (installation: Installation) => boolean = () => true, private readonly memoryReadiness: (tenantId: string) => MemoryReadiness = () => 'disabled', private readonly memory?: HostedMemoryPort, private readonly openRouter?: { crypto: OpenRouterConnectionCrypto; verify: (key: string) => Promise<boolean> }) {}

  private providerIssues(context: ExecutionContext, draft: GraphDraft): GraphIssue[] {
    return draft.nodes.flatMap((node, index) => node.kind !== 'agent' ? [] : !this.availableProviders.includes(String(node.config['provider'])) ? [{ path: `/nodes/${index}/config`, code: 'PROVIDER_NOT_READY', message: 'provider not ready' }] : []);
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

  async draft(context: ExecutionContext, draftId: string): Promise<StudioStoredDraft<StudioDraft | GraphDraft>> { return this.studio.get(context, id(draftId)); }
  async drafts(context: ExecutionContext): Promise<readonly StudioStoredDraft<StudioDraft | GraphDraft>[]> { return (await this.studio.list(context)).filter((item) => (item.draft as unknown as GraphDraft).kind === 'graph-v1'); }

  async pins(context: ExecutionContext, draftId: string): Promise<CapabilityPin[]> {
    const grants = (await this.store.list<CapabilityGrant>(context, 'grant')).filter((record) => record.state === 'active' && record.data.draftId === draftId);
    const installations = await this.store.list<Installation>(context, 'installation');
    return grants.flatMap((grant) => {
      const installation = installations.find((item) => item.id === grant.data.installationId && item.state === 'healthy' && item.data.manifest.certified && item.data.manifest.digest === grant.data.manifestDigest && this.connectorReady(item.data));
      const capability = installation?.data.manifest.capabilities.find((item) => item.name === grant.data.capability);
      return installation && capability ? [{ nodeId: grant.data.nodeId, installationId: installation.id, capability: capability.name, manifestDigest: installation.data.manifest.digest, grantId: grant.id, risk: capability.risk, inputSchema: capability.inputSchema, outputSchema: capability.outputSchema }] : [];
    });
  }

  async check(context: ExecutionContext, draftId: string, expectedVersion?: number): Promise<{ revision: number; digest: string; candidateDigest?: string; issues: GraphIssue[]; evidenceId: string }> {
    await this.store.assertProfile(context, 'editor');
    const stored = await this.draft(context, draftId); const pins = await this.pins(context, draftId);
    if (expectedVersion !== undefined && stored.revision !== expectedVersion) fail('STALE');
    const issues = [...validateGraph(graph(stored), pins), ...this.providerIssues(context, graph(stored))];
    const candidate = issues.length ? undefined : await compileGraph(definitionId(draftId, stored.revision), stored.revision, graph(stored), pins);
    const evidenceId = randomUUID();
    await this.studio.appendRun(context, draftId, { id: evidenceId, revision: stored.revision, subjectDigest: stored.digest, kind: 'checks', status: issues.length ? 'failed' : 'passed', report: { classification: 'live', issues, ...(candidate ? { candidateDigest: candidate.digest } : {}) } });
    return { revision: stored.revision, digest: stored.digest, ...(candidate ? { candidateDigest: candidate.digest } : {}), issues, evidenceId };
  }

  async publish(context: ExecutionContext, draftId: string, reviewDigest: string, expectedVersion?: number): Promise<WorkflowDefinition> {
    await this.store.assertProfile(context, 'admin');
    const stored = await this.draft(context, draftId); const pins = await this.pins(context, draftId);
    if (expectedVersion !== undefined && stored.revision !== expectedVersion) fail('STALE');
    if (this.providerIssues(context, graph(stored)).length) fail('FEATURE_NOT_READY');
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
    const run: WorkflowRun = { id: runId, tenantId: String(context.tenantId), ownerId: context.userId, stableDefinitionId: published.draftId, definitionId: published.id, definitionRevision: published.draftRevision, definitionDigest: published.digest, inputDigest, input, status: 'queued', history: [], outputs: {}, summaryStatus: 'pending' };
    const receipt = { commandId: key, objectId: runId, revision: 1, state: 'queued', digest: published.digest, evidenceIds: [] };
    const result = await this.store.write(context, 'operator', 'run', runId, 0, 'queued', run, key, requestDigest, receipt);
    await scheduler.start(runId, String(context.tenantId), published.id);
    return { runId, replayed: result.replayed, digest: published.digest };
  }

  async approve(context: ExecutionContext, runId: string, bindingDigest: string, decision: 'approve' | 'reject', expectedVersion: number, key: string, requestDigest: string): Promise<void> {
    const scheduler = this.scheduler; if (!scheduler) throw Object.assign(new Error('FEATURE_NOT_READY'), { code: 'FEATURE_NOT_READY' });
    await this.store.assertProfile(context, 'admin');
    const current = await this.store.read<WorkflowRun>(context, 'run', id(runId));
    if (current?.data.history.some((item) => item.kind === 'approval' && item.bindingDigest === bindingDigest && item.detail === decision)) { await scheduler.raise(runId, 'approval', { bindingDigest, decision }); return; }
    if (!current || current.version !== expectedVersion || current.data.status !== 'waiting-approval' || !current.data.waiting || current.data.waiting.bindingDigest !== bindingDigest || Date.parse(current.data.waiting.expiresAt) <= Date.now()) throw Object.assign(new Error('STALE'), { code: 'STALE' });
    const updated = { ...current.data, history: [...current.data.history, { nodeId: current.data.waiting.nodeId, kind: 'approval', state: decision === 'approve' ? 'completed' : 'failed', at: new Date().toISOString(), detail: decision, bindingDigest } satisfies RunEvent] };
    delete updated.waiting;
    await this.store.write(context, 'admin', 'run', runId, current.version, decision === 'approve' ? 'running' : 'failed', { ...updated, status: decision === 'approve' ? 'running' : 'failed' }, key, requestDigest, { commandId: key, objectId: runId, revision: current.version + 1, state: decision, digest: bindingDigest, evidenceIds: [] });
    await scheduler.raise(runId, 'approval', { bindingDigest, decision });
  }

  async grant(context: ExecutionContext, draftId: string, nodeId: string, installationId: string, capability: string, key: string, requestDigest: string): Promise<void> {
    await this.store.assertProfile(context, 'admin');
    const draft = graph(await this.draft(context, id(draftId)));
    if (!draft.nodes.some((node) => node.id === nodeId && node.kind === 'mcp')) fail('INVALID');
    const installation = await this.store.read<Installation>(context, 'installation', id(installationId));
    if (!installation || installation.state !== 'healthy' || !this.connectorReady(installation.data) || !installation.data.manifest.certified || !installation.data.manifest.capabilities.some((item) => item.name === capability)) throw Object.assign(new Error('DENIED'), { code: 'DENIED' });
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
    if (action === 'set-expiry' && (!expiresAt || !current.data.expiresAt || Number.isNaN(Date.parse(expiresAt)) || Number.isNaN(Date.parse(current.data.expiresAt)) || new Date(expiresAt).toISOString() !== expiresAt || Date.parse(expiresAt) > Date.parse(current.data.expiresAt) || Date.parse(expiresAt) > Date.now() + 90 * 86400000)) return fail('INVALID');
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
      const expiresAt = current.data.expiresAt ?? new Date(Date.now() + 90 * 86400000).toISOString();
      const data: MemoryItem = { ...current.data, type: current.data.type === 'run-summary' ? 'task-fact' : current.data.type, fingerprint, predecessorId: current.id, expiresAt, vectorState: 'pending' };
      await this.store.write(context, 'admin', 'memory-item', successorId, 0, 'pending', data, id(key), requestDigest, { commandId: key, objectId: successorId, revision: 1, state: 'pending', digest: await digest(data), evidenceIds: [current.id] });
    }
    const withdrawn: MemoryItem = { ...current.data, vectorState: 'remove-pending' };
    await this.store.write(context, 'admin', 'memory-item', current.id, current.version, 'withdrawn', withdrawn, memoryItemId(`withdraw:${key}`), requestDigest, { commandId: key, objectId: current.id, revision: current.version + 1, state: 'withdrawn', digest: await digest(withdrawn), evidenceIds: [successorId] });
    await this.scheduler?.correctMemory?.(successorId, tenantId, text);
    await this.scheduler?.removeMemory?.(current.id, tenantId);
  }

  async invalidateMemorySource(context: ExecutionContext, sourceId: string, key: string, requestDigest: string): Promise<void> {
    await this.store.assertProfile(context, 'admin');
    if (!sourceId.startsWith('input:') && !sourceId.startsWith('event:') && !sourceId.startsWith('summary:')) return fail('INVALID');
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
    if (!['public', 'private'].includes(installation.route) || !['healthy', 'offline'].includes(installation.health) || !manifest || Object.keys(manifest).some((field) => !['digest', 'version', 'certified', 'capabilities'].includes(field)) || manifest.certified !== true || typeof manifest.version !== 'string' || !manifest.version || !Array.isArray(manifest.capabilities) || !manifest.capabilities.length || manifest.capabilities.some((item) => !item || Object.keys(item).some((field) => !['name', 'risk', 'inputSchema', 'outputSchema'].includes(field)) || typeof item.name !== 'string' || !item.name || !['R1', 'R2', 'R3'].includes(item.risk) || !validateSchema(item.inputSchema) || !validateSchema(item.outputSchema)) || new Set(manifest.capabilities.map((item) => item.name)).size !== manifest.capabilities.length) fail('INVALID');
    if (installation.route === 'public') { try { const endpoint = new URL(installation.endpoint ?? ''); if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) fail('INVALID'); } catch { fail('INVALID'); } }
    const actualDigest = await digest({ version: installation.manifest.version, capabilities: installation.manifest.capabilities });
    if (installation.manifest.digest !== actualDigest) fail('INVALID');
    const current = await this.store.read<Installation>(context, 'installation', installationId);
    if (current && (current.state === 'revoked' || current.data.route !== installation.route || current.data.endpoint !== installation.endpoint || current.data.manifest.digest !== actualDigest)) fail('CONFLICT');
    installation = { ...installation, id: installationId, ...(installation.route === 'private' ? { health: current?.data.health ?? 'offline' as const, ...(current?.data.tokenHash ? { tokenHash: current.data.tokenHash } : {}) } : {}) };
    await this.store.write(context, 'admin', 'installation', id(installationId), expectedVersion, installation.health, installation, key, requestDigest, { commandId: key, objectId: installationId, revision: expectedVersion + 1, state: installation.health, digest: installation.manifest.digest, evidenceIds: [] });
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

  async projection(context: ExecutionContext, collection: string, recordId?: string): Promise<Record<string, unknown>> {
    const tenantId = String(context.tenantId);
    let records: Record<string, unknown>[] = [];
    if (collection === 'workflow-drafts') records = (await this.drafts(context)).map((item) => ({ id: item.id, revision: item.revision, digest: item.digest, state: item.state, graph: item.draft }));
    else if (collection === 'workflow-definitions') records = (await this.store.definitions(context, recordId)).map((item) => ({ id: item.id, draftId: item.draftId, revision: item.draftRevision, digest: item.digest, nodes: item.definition.nodes.map((node) => ({ id: node.id, kind: node.kind, next: node.next })), capabilityPins: item.definition.capabilityPins.map((pin) => ({ capability: pin.capability, risk: pin.risk, manifestDigest: pin.manifestDigest })) }));
    else if (collection === 'workflow-runs') {
      const effects = await this.store.list<{ runId: string; nodeId: string; requestDigest: string; argumentsDigest: string }>(context, 'effect');
      const retrievals = await this.store.list<{ runId: string; nodeId: string; status: string; itemIds: readonly string[]; importIds: readonly string[]; failure?: string }>(context, 'memory-retrieval');
      records = (await this.store.list<WorkflowRun>(context, 'run')).slice(0, 50).map((item) => ({ id: item.id, version: item.version, status: item.data.status, definitionId: item.data.definitionId, stableDefinitionId: item.data.stableDefinitionId, definitionRevision: item.data.definitionRevision, definitionDigest: item.data.definitionDigest, inputDigest: item.data.inputDigest, inputSummary: Object.entries(item.data.input).map(([field, value]) => ({ field, type: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value })), history: item.data.history, effects: effects.filter((effect) => effect.data.runId === item.id).map((effect) => ({ id: effect.id, nodeId: effect.data.nodeId, state: effect.state, requestDigest: effect.data.requestDigest, argumentsDigest: effect.data.argumentsDigest })), retrievals: retrievals.filter((entry) => entry.data.runId === item.id).map((entry) => ({ id: entry.id, nodeId: entry.data.nodeId, status: entry.data.status, itemIds: entry.data.itemIds, importIds: entry.data.importIds, ...(memoryFailure(entry.data.failure) ? { failure: memoryFailure(entry.data.failure) } : {}) })), ...(item.data.waiting ? { waiting: item.data.waiting } : {}), ...(item.data.summaryStatus ? { summaryStatus: item.data.summaryStatus } : {}) }));
    }
    else if (collection === 'connector-installations') records = (await this.store.list<Installation>(context, 'installation')).map((item) => ({ id: item.id, version: item.version, state: item.state, route: item.data.route, health: item.data.health, manifest: item.data.manifest }));
    else if (collection === 'workflow-grants') records = (await this.store.list<CapabilityGrant>(context, 'grant')).map((item) => ({ id: item.id, version: item.version, state: item.state, ...item.data }));
    else if (collection === 'workflow-webhook-credentials') records = (await this.store.list<WebhookCredential>(context, 'webhook-credential')).map((item) => ({ id: item.id, version: item.version, state: item.state, definitionId: item.data.definitionId, enabled: item.data.enabled, rotatedAt: item.data.rotatedAt, ...(item.data.previousExpiresAt ? { previousExpiresAt: item.data.previousExpiresAt } : {}) }));
    else if (collection === 'openrouter-connections') records = (await this.store.list<OpenRouterConnection>(context, 'openrouter-connection')).map((item) => ({ id: item.id, version: item.version, state: item.state, provider: item.data.provider, enabled: item.data.enabled, ...(item.data.verifiedAt ? { verifiedAt: item.data.verifiedAt } : {}) }));
    else if (collection === 'workflow-memory-imports') records = (await this.store.list<MemoryImport>(context, 'memory-import')).map((item) => ({ id: item.id, version: item.version, ...item.data }));
    else if (collection === 'workflow-memory-items') records = (await this.store.list<MemoryItem>(context, 'memory-item')).map((item) => ({ id: item.id, version: item.version, state: item.state, stableDefinitionId: item.data.stableDefinitionId, definitionId: item.data.definitionId, producingRevision: item.data.producingRevision, type: item.data.type, sourceId: item.data.sourceId, sourceDigest: item.data.sourceDigest, ownerScoped: item.data.ownerId !== undefined, ...(item.data.predecessorId ? { predecessorId: item.data.predecessorId } : {}), ...(item.data.promotedAt ? { promotedAt: item.data.promotedAt } : {}), ...(item.data.expiresAt ? { expiresAt: item.data.expiresAt } : {}), hold: item.data.hold === true, ...(memoryFailure(item.data.failure) ? { failure: memoryFailure(item.data.failure) } : {}), vectorState: item.data.vectorState }));
    else if (collection === 'workflow-memory-readiness') { const state = this.memoryReadiness(tenantId); records = [{ id: '00000000-0000-5000-8000-000000000001', state, enabled: state === 'ready', provider: 'upstash-vector' }]; }
    else fail('INVALID');
    if (recordId) records = records.filter((item) => item['id'] === recordId);
    return { tenantId, collection, records, completeness: ['workflow-runs', 'workflow-definitions', 'connector-installations'].includes(collection) ? 'partial' : 'full', classification: 'restricted-operational', freshness: 'current', redaction: 'applied' };
  }
}
