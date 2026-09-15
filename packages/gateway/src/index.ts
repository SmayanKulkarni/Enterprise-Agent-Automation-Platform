import { canonicalJson, digest, tenantId, type NormalizedError, type TenantId } from '../../contracts/src/index.js';

export class GatewayError extends Error {
  constructor(public readonly code: 'CONFLICT' | 'DENIED' | 'INVALID' | 'NOT_FOUND' | 'UNKNOWN_OUTCOME') { super('Gateway request was not accepted.'); this.name = 'GatewayError'; }
}
const fail = (code: GatewayError['code']): never => { throw new GatewayError(code); };
const json = (value: unknown): unknown => JSON.parse(canonicalJson(value));
const validDigest = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
function frozen<T>(value: T): T { if (value !== null && typeof value === 'object') { for (const child of Object.values(value)) frozen(child); Object.freeze(value); } return value; }

export interface CapabilityDefinition { name: string; version: string; inputKeys: readonly string[]; outputKeys: readonly string[]; }
export interface AdapterRelease { id: string; provider: string; version: string; definitions: readonly string[]; digest: string; keyId: string; signature: string; }
export interface ProviderInstallation { id: string; tenantId: TenantId; releaseId: string; accountId: string; callbackId: string; state: InstallationState; version: number; generation: number; checkpoint: number; }
export type InstallationState = 'installing' | 'validating' | 'healthy' | 'degraded' | 'reauthorization-required' | 'schema-incompatible' | 'disabled' | 'revoked' | 'quarantined' | 'removed';
export interface CapabilityAvailability { tenantId: TenantId; installationId: string; capability: string; state: 'healthy' | 'degraded' | 'throttled-until' | 'reconciliation-required' | 'disabled' | 'revoked'; freshness: string; reason: string; }

export async function signRelease(keyId: string, secret: string, release: Omit<AdapterRelease, 'digest' | 'keyId' | 'signature'>): Promise<Pick<AdapterRelease, 'digest' | 'keyId' | 'signature'>> {
  const payload = { definitions: [...release.definitions].sort(), id: release.id, provider: release.provider, version: release.version };
  const releaseDigest = await digest(payload);
  return { digest: releaseDigest, keyId, signature: await digest({ keyId, releaseDigest, secret }) };
}

/** Local registry keeps definitions, releases and installations distinct. */
export class CapabilityRegistry {
  readonly #definitions = new Map<string, CapabilityDefinition>(); readonly #releases = new Map<string, AdapterRelease>(); readonly #keys: Readonly<Record<string, string>>;
  constructor(keys: Readonly<Record<string, string>>) { this.#keys = { ...keys }; }
  registerDefinition(definition: CapabilityDefinition): CapabilityDefinition {
    if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/u.test(definition.name) || !/^\d+\.\d+\.\d+$/u.test(definition.version) || !definition.inputKeys.length || new Set([...definition.inputKeys, ...definition.outputKeys]).size !== definition.inputKeys.length + definition.outputKeys.length) fail('INVALID');
    const current = this.#definitions.get(definition.name); if (current !== undefined && canonicalJson(current) !== canonicalJson(definition)) fail('CONFLICT');
    const frozen = Object.freeze({ ...definition, inputKeys: Object.freeze([...definition.inputKeys]), outputKeys: Object.freeze([...definition.outputKeys]) }); this.#definitions.set(frozen.name, frozen); return frozen;
  }
  async registerRelease(release: AdapterRelease): Promise<AdapterRelease> {
    const secret = this.#keys[release.keyId]; if (secret === undefined) throw new GatewayError('DENIED');
    if (!release.id || !release.provider || !/^\d+\.\d+\.\d+$/u.test(release.version) || !release.definitions.length || release.definitions.some((name) => !this.#definitions.has(name))) fail('DENIED');
    const signed = await signRelease(release.keyId, secret, release); if (signed.digest !== release.digest || signed.signature !== release.signature) fail('DENIED');
    const current = this.#releases.get(release.id); if (current !== undefined && canonicalJson(current) !== canonicalJson(release)) fail('CONFLICT');
    const frozen = Object.freeze({ ...release, definitions: Object.freeze([...release.definitions].sort()) }); this.#releases.set(frozen.id, frozen); return frozen;
  }
  definition(name: string): CapabilityDefinition { return this.#definitions.get(name) ?? fail('NOT_FOUND'); }
  release(id: string): AdapterRelease { return this.#releases.get(id) ?? fail('NOT_FOUND'); }
  assertShape(keys: readonly string[], value: Record<string, unknown>): void { if (Object.keys(value).some((key) => !keys.includes(key))) fail('INVALID'); }
}

const transitions: Readonly<Record<InstallationState, readonly InstallationState[]>> = {
  installing: ['validating', 'disabled', 'revoked', 'quarantined', 'removed'], validating: ['healthy', 'quarantined', 'schema-incompatible', 'reauthorization-required', 'disabled', 'revoked', 'removed'], healthy: ['degraded', 'reauthorization-required', 'schema-incompatible', 'disabled', 'revoked', 'quarantined', 'removed'], degraded: ['healthy', 'reauthorization-required', 'schema-incompatible', 'disabled', 'revoked', 'quarantined', 'removed'], 'reauthorization-required': ['validating', 'disabled', 'revoked', 'quarantined', 'removed'], 'schema-incompatible': ['validating', 'disabled', 'revoked', 'quarantined', 'removed'], disabled: ['validating', 'revoked', 'quarantined', 'removed'], revoked: ['removed'], quarantined: ['validating', 'revoked', 'removed'], removed: [],
};
export class ProviderInstallationManager {
  readonly #installations = new Map<string, ProviderInstallation>();
  constructor(private readonly registry: CapabilityRegistry, private readonly now: () => string = () => new Date().toISOString()) {}
  install(input: Omit<ProviderInstallation, 'tenantId' | 'state' | 'version' | 'generation' | 'checkpoint'> & { tenantId: string }): ProviderInstallation {
    const id = tenantId(input.tenantId); if (!input.id || !input.accountId || !input.callbackId || this.#installations.has(input.id)) fail('CONFLICT'); this.registry.release(input.releaseId);
    const installation: ProviderInstallation = { ...input, tenantId: id, state: 'installing', version: 1, generation: 1, checkpoint: 0 }; this.#installations.set(installation.id, installation); return installation;
  }
  transition(id: string, expectedVersion: number, state: InstallationState): ProviderInstallation {
    const current = this.get(id); if (current.version !== expectedVersion || !transitions[current.state].includes(state)) fail('DENIED');
    const next = { ...current, state, version: current.version + 1, generation: current.generation + 1 }; this.#installations.set(id, next); return next;
  }
  validate(id: string, expectedVersion: number, checks: { account: boolean; callback: boolean; health: boolean; schema: boolean; signature: boolean }): ProviderInstallation {
    const current = this.transition(id, expectedVersion, 'validating'); const state: InstallationState = checks.signature && checks.account && checks.callback ? checks.schema ? checks.health ? 'healthy' : 'degraded' : 'schema-incompatible' : 'quarantined'; return this.transition(id, current.version, state);
  }
  callback(input: { installationId: string; tenantId: string; accountId: string; callbackId: string; cursor: number; generation: number }): ProviderInstallation {
    const current = this.get(input.installationId); if (current.state !== 'healthy' || current.tenantId !== tenantId(input.tenantId) || current.accountId !== input.accountId || current.callbackId !== input.callbackId || current.generation !== input.generation || !Number.isSafeInteger(input.cursor) || input.cursor !== current.checkpoint + 1) fail('DENIED');
    const next = { ...current, checkpoint: input.cursor }; this.#installations.set(next.id, next); return next;
  }
  availability(id: string, capability: string): CapabilityAvailability {
    const installation = this.get(id); const release = this.registry.release(installation.releaseId); if (!release.definitions.includes(capability)) fail('NOT_FOUND');
    const state = installation.state === 'healthy' || installation.state === 'degraded' ? installation.state : installation.state === 'revoked' ? 'revoked' : installation.state === 'disabled' ? 'disabled' : 'reconciliation-required';
    return { tenantId: installation.tenantId, installationId: id, capability, state, freshness: this.now(), reason: installation.state };
  }
  discover(tenant: string): CapabilityAvailability[] { const id = tenantId(tenant); return [...this.#installations.values()].filter((installation) => installation.tenantId === id && ['healthy', 'degraded'].includes(installation.state)).flatMap((installation) => this.registry.release(installation.releaseId).definitions.map((capability) => this.availability(installation.id, capability))); }
  assertInvocable(tenant: string, installationId: string, capability: string): ProviderInstallation { const installation = this.get(installationId); if (installation.tenantId !== tenantId(tenant) || this.availability(installationId, capability).state !== 'healthy') fail('DENIED'); return installation; }
  definitionFor(installationId: string, capability: string): CapabilityDefinition { const installation = this.get(installationId); if (!this.registry.release(installation.releaseId).definitions.includes(capability)) fail('DENIED'); return this.registry.definition(capability); }
  upgrade(id: string, expectedVersion: number, releaseId: string, checks: { health: boolean; schema: boolean; signature: boolean }): ProviderInstallation {
    const current = this.get(id); this.registry.release(releaseId); if (current.state !== 'healthy' || current.version !== expectedVersion || !checks.health || !checks.schema || !checks.signature) fail('DENIED');
    const next = { ...current, releaseId, version: current.version + 1, generation: current.generation + 1 }; this.#installations.set(id, next); return next;
  }
  get(id: string): ProviderInstallation { return this.#installations.get(id) ?? fail('NOT_FOUND'); }
}

export type CredentialState = 'active' | 'expired' | 'revoked';
export interface CredentialReference { id: string; tenantId: TenantId; installationId: string; accountId: string; scopes: readonly string[]; secretStoreRef: string; version: number; epoch: number; expiresAt: string; state: CredentialState; }
export interface CredentialReceipt { credentialId: string; epoch: number; event: 'consented' | 'rotated' | 'rotation-failed' | 'revoked'; }
export interface InvocationCredential { reference: Pick<CredentialReference, 'id' | 'installationId' | 'epoch' | 'version'>; token: string; expiresAt: string; }

/** A deterministic local adapter: records hold references, never secret material. */
export class FakeSecretStore {
  readonly #values = new Map<string, string>(); public available = true;
  put(reference: string, material: string): void { if (!this.available || !material) fail('DENIED'); this.#values.set(reference, material); }
  get(reference: string): string { if (!this.available) fail('DENIED'); return this.#values.get(reference) ?? fail('DENIED'); }
  delete(reference: string): void { this.#values.delete(reference); }
}

export class CredentialBroker {
  readonly #references = new Map<string, CredentialReference>(); readonly #cache = new Map<string, { epoch: number; token: string }>(); readonly #leases = new Set<string>(); readonly #receipts: CredentialReceipt[] = [];
  constructor(private readonly secrets: FakeSecretStore, private readonly now: () => string = () => new Date().toISOString()) {}
  consent(input: Omit<CredentialReference, 'tenantId' | 'secretStoreRef' | 'version' | 'epoch' | 'state'> & { tenantId: string; consented: boolean }, material: string): CredentialReference {
    const tenant = tenantId(input.tenantId); if (!input.id || !input.installationId || !input.accountId || !input.consented || !input.scopes.length || new Set(input.scopes).size !== input.scopes.length || Date.parse(input.expiresAt) <= Date.parse(this.now()) || this.#references.has(input.id)) fail('DENIED');
    const reference: CredentialReference = Object.freeze({ id: input.id, tenantId: tenant, installationId: input.installationId, accountId: input.accountId, scopes: Object.freeze([...input.scopes]), secretStoreRef: `fake-secret://${input.id}/1`, version: 1, epoch: 1, expiresAt: input.expiresAt, state: 'active' }); this.secrets.put(reference.secretStoreRef, material); this.#references.set(reference.id, reference); this.#receipts.push({ credentialId: reference.id, epoch: reference.epoch, event: 'consented' }); return reference;
  }
  reference(id: string): CredentialReference { return this.#references.get(id) ?? fail('NOT_FOUND'); }
  usable(id: string): boolean { const reference = this.reference(id); return reference.state === 'active' && Date.parse(reference.expiresAt) > Date.parse(this.now()); }
  acquire(input: { tenantId: string; installationId: string; scope: string; authorityCurrent: boolean }): InvocationCredential {
    const tenant = tenantId(input.tenantId); const reference = [...this.#references.values()].find((item) => item.tenantId === tenant && item.installationId === input.installationId && item.scopes.includes(input.scope) && this.usable(item.id)) ?? fail('DENIED');
    if (!input.authorityCurrent) fail('DENIED'); const cached = this.#cache.get(reference.id); const token = cached?.epoch === reference.epoch ? cached.token : this.secrets.get(reference.secretStoreRef); this.#cache.set(reference.id, { epoch: reference.epoch, token }); return { reference: { id: reference.id, installationId: reference.installationId, epoch: reference.epoch, version: reference.version }, token, expiresAt: reference.expiresAt };
  }
  async rotate(id: string, expectedVersion: number, material: string, expiresAt: string, probe: (candidate: InvocationCredential) => Promise<boolean> | boolean): Promise<CredentialReference> {
    const current = this.reference(id); if (current.state !== 'active' || current.version !== expectedVersion || Date.parse(expiresAt) <= Date.parse(this.now()) || this.#leases.has(id)) fail('DENIED'); this.#leases.add(id);
    try {
      const candidate: CredentialReference = { ...current, secretStoreRef: `fake-secret://${id}/${String(current.version + 1)}`, version: current.version + 1, epoch: current.epoch + 1, expiresAt }; this.secrets.put(candidate.secretStoreRef, material); const passed = await probe({ reference: { id: candidate.id, installationId: candidate.installationId, epoch: candidate.epoch, version: candidate.version }, token: this.secrets.get(candidate.secretStoreRef), expiresAt: candidate.expiresAt });
      if (!passed) { this.secrets.delete(candidate.secretStoreRef); this.#receipts.push({ credentialId: id, epoch: current.epoch, event: 'rotation-failed' }); fail('DENIED'); }
      this.secrets.delete(current.secretStoreRef); const next = Object.freeze(candidate); this.#references.set(id, next); this.#cache.delete(id); this.#receipts.push({ credentialId: id, epoch: next.epoch, event: 'rotated' }); return next;
    } finally { this.#leases.delete(id); }
  }
  revoke(id: string): CredentialReference { const current = this.reference(id); const next = Object.freeze({ ...current, epoch: current.epoch + 1, state: 'revoked' as const }); this.secrets.delete(current.secretStoreRef); this.#cache.delete(id); this.#references.set(id, next); this.#receipts.push({ credentialId: id, epoch: next.epoch, event: 'revoked' }); return next; }
  receipts(): readonly CredentialReceipt[] { return [...this.#receipts]; }
}

export interface ExtensionPolicy { maxBytes: number; network: readonly string[]; resources: readonly string[]; }
export interface ExtensionRequest { tenantId: string; packageDigest: string; capability: string; input: Record<string, unknown>; deadline: string; policy: ExtensionPolicy; cancelled?: boolean; }
export interface ExtensionResult { outcome: 'succeeded' | 'cancelled' | 'rejected' | 'crashed'; output?: Record<string, unknown>; resourceBytes: number; }
export interface ExtensionRunner { run(request: ExtensionRequest, execute: (input: Readonly<{ tenantId: TenantId; capability: string; input: Record<string, unknown>; deadline: string }>) => Promise<Record<string, unknown>> | Record<string, unknown>): Promise<ExtensionResult>; }

/** Local runner is processless by design: it exposes no host, identity, network or filesystem handles. */
export class DisposableLocalExtensionRunner implements ExtensionRunner {
  constructor(private readonly now: () => string = () => new Date().toISOString()) {}
  async run(request: ExtensionRequest, execute: (input: Readonly<{ tenantId: TenantId; capability: string; input: Record<string, unknown>; deadline: string }>) => Promise<Record<string, unknown>> | Record<string, unknown>): Promise<ExtensionResult> {
    const tenant = tenantId(request.tenantId); if (!validDigest(request.packageDigest) || !request.capability || !request.policy.resources.includes(request.capability) || request.policy.network.length || !Number.isSafeInteger(request.policy.maxBytes) || request.policy.maxBytes < 1 || Date.parse(request.deadline) <= Date.parse(this.now())) fail('DENIED'); if (request.cancelled) return { outcome: 'cancelled', resourceBytes: 0 };
    try { const input = Object.freeze({ tenantId: tenant, capability: request.capability, input: frozen(json(request.input) as Record<string, unknown>), deadline: request.deadline }); const output = await execute(input); const bytes = new TextEncoder().encode(canonicalJson(output)).byteLength; if (bytes > request.policy.maxBytes || output['dlpSafe'] === false || output['malwareDetected'] === true || Object.keys(output).some((key) => /secret|token|authorization/iu.test(key))) fail('DENIED'); return { outcome: 'succeeded', output: frozen(json(output) as Record<string, unknown>), resourceBytes: bytes }; } catch (error) { if (error instanceof GatewayError) throw error; return { outcome: 'crashed', resourceBytes: 0 }; }
  }
}

export interface ProviderReadiness { installationId: string; releaseId: string; credentialEpoch: number; ready: boolean; reason: string; }
/** Couples atomic release selection with the current credential epoch for Lifecycle consumers. */
export class ProviderLifecycle {
  readonly #transitions: { installationId: string; fromRelease: string; toRelease: string; generation: number }[] = [];
  constructor(private readonly installations: ProviderInstallationManager, private readonly credentials: CredentialBroker) {}
  readiness(installationId: string, credentialId: string): ProviderReadiness { const installation = this.installations.get(installationId); const credential = this.credentials.reference(credentialId); const ready = installation.state === 'healthy' && this.credentials.usable(credentialId) && credential.tenantId === installation.tenantId && credential.installationId === installation.id; return { installationId, releaseId: installation.releaseId, credentialEpoch: credential.epoch, ready, reason: ready ? 'ready' : credential.state === 'revoked' ? 'credential-revoked' : 'not-ready' }; }
  upgrade(installationId: string, expectedVersion: number, releaseId: string, checks: { health: boolean; schema: boolean; signature: boolean }, credentialId: string): ProviderInstallation { const before = this.installations.get(installationId); if (!this.readiness(installationId, credentialId).ready) fail('DENIED'); const next = this.installations.upgrade(installationId, expectedVersion, releaseId, checks); this.#transitions.push({ installationId, fromRelease: before.releaseId, toRelease: next.releaseId, generation: next.generation }); return next; }
  remove(installationId: string, expectedVersion: number, credentialId: string, residueReconciled: boolean): ProviderInstallation { if (!residueReconciled) fail('DENIED'); const credential = this.credentials.reference(credentialId); if (credential.state === 'active') this.credentials.revoke(credentialId); return this.installations.transition(installationId, expectedVersion, 'removed'); }
  transitions(): readonly { installationId: string; fromRelease: string; toRelease: string; generation: number }[] { return [...this.#transitions]; }
}

export interface CapabilityInvocation { id: string; tenantId: string; effectId: string; attemptId: string; caseId: string; generation: number; idempotencyKey: string; capability: string; installationId: string; accountId: string; resource: string; operation: string; arguments: Record<string, unknown>; deadline: string; authorityCurrent: boolean; approvalCurrent: boolean; budgetRemaining: number; cancelled?: boolean; }
export interface NormalizedInvocation { effectId: string; attemptId: string; operation: string; accountId: string; resource: string; arguments: Record<string, unknown>; deadline: string; credential: { installationId: string; scope: string }; }
export interface AdapterResult { outcome: 'succeeded' | 'provider-rejected' | 'retryable' | 'throttled' | 'unknown-outcome'; output?: Record<string, unknown>; providerRef?: string; retryAfterSeconds?: number; }
export interface ProviderAdapter { invoke(input: Readonly<NormalizedInvocation>): Promise<AdapterResult> | AdapterResult; reconcile?(input: Readonly<NormalizedInvocation>): Promise<'succeeded' | 'not-found' | 'inconclusive'> | 'succeeded' | 'not-found' | 'inconclusive'; }
export interface EffectAttempt { id: string; effectId: string; dispatchedAt?: string; certainty: 'not-dispatched' | 'possible-send' | 'confirmed'; }
export interface EffectReceipt { effectId: string; attemptId: string; outcome: 'not-dispatched' | AdapterResult['outcome'] | 'cancelled-before-send'; certainty: EffectAttempt['certainty']; error?: NormalizedError; reconciliationRequired: boolean; }
export interface ReconciliationCheckpoint { effectId: string; attemptId: string; state: 'resolved' | 'operator-required'; disposition: 'adopt' | 'await-reconcile'; }
interface StoredEffect { digest: string; input: CapabilityInvocation; normalized: NormalizedInvocation; attempts: EffectAttempt[]; receipt?: EffectReceipt; }
export interface GatewayOptions { concurrency?: number; queue?: number; perMinute?: number; now?: () => string; quotaKey?: (input: CapabilityInvocation) => string | undefined; }

export class CapabilityGateway {
  readonly #effects = new Map<string, StoredEffect>(); readonly #waiting: (() => void)[] = []; readonly #starts = new Map<string, number[]>(); #inFlight = 0;
  readonly #concurrency: number; readonly #queue: number; readonly #perMinute: number; readonly #now: () => string;
  constructor(private readonly installations: ProviderInstallationManager, private readonly adapter: ProviderAdapter, options: GatewayOptions = {}) { this.#concurrency = options.concurrency ?? 4; this.#queue = options.queue ?? 16; this.#perMinute = options.perMinute ?? 60; this.#now = options.now ?? (() => new Date().toISOString()); this.quotaKey = options.quotaKey ?? (() => undefined); if (![this.#concurrency, this.#queue, this.#perMinute].every((value) => Number.isSafeInteger(value) && value > 0)) fail('INVALID'); }
  private readonly quotaKey: (input: CapabilityInvocation) => string | undefined;
  async invoke(input: CapabilityInvocation): Promise<EffectReceipt> {
    const normalized = this.admit(input); const requestDigest = await digest({ ...input, arguments: json(input.arguments), cancelled: input.cancelled ?? false }); const prior = this.#effects.get(input.effectId);
    if (prior !== undefined) { if (prior.digest !== requestDigest) fail('CONFLICT'); return prior.receipt ?? { effectId: input.effectId, attemptId: input.attemptId, outcome: 'unknown-outcome', certainty: 'possible-send', reconciliationRequired: true }; }
    const stored: StoredEffect = { digest: requestDigest, input: { ...input, arguments: json(input.arguments) as Record<string, unknown> }, normalized, attempts: [] }; this.#effects.set(input.effectId, stored);
    if (input.cancelled || Date.parse(input.deadline) <= Date.parse(this.#now())) return this.finish(stored, { effectId: input.effectId, attemptId: input.attemptId, outcome: 'cancelled-before-send', certainty: 'not-dispatched', reconciliationRequired: false });
    try { await this.reserve(); } catch (error) { if (error instanceof GatewayError) return this.finish(stored, { effectId: input.effectId, attemptId: input.attemptId, outcome: 'not-dispatched', certainty: 'not-dispatched', error: { category: 'retryable', code: 'ADMISSION_OVERLOADED', message: 'Capability request was not accepted.', redacted: true }, reconciliationRequired: false }); throw error; }
    const attempt: EffectAttempt = { id: input.attemptId, effectId: input.effectId, dispatchedAt: this.#now(), certainty: 'possible-send' }; stored.attempts.push(attempt);
    try {
      const result = await this.adapter.invoke(Object.freeze(normalized));
      if (!['succeeded', 'provider-rejected', 'retryable', 'throttled', 'unknown-outcome'].includes(result.outcome) || Object.keys(result).some((key) => !['outcome', 'output', 'providerRef', 'retryAfterSeconds'].includes(key))) fail('INVALID');
      if (result.output !== undefined) this.assertOutput(input, result.output);
      attempt.certainty = result.outcome === 'unknown-outcome' ? 'possible-send' : 'confirmed';
      const error = result.outcome === 'succeeded' ? undefined : this.error(result.outcome, result.retryAfterSeconds);
      return this.finish(stored, { effectId: input.effectId, attemptId: input.attemptId, outcome: result.outcome, certainty: attempt.certainty, ...(error === undefined ? {} : { error }), reconciliationRequired: result.outcome === 'unknown-outcome' });
    } catch (error) { if (error instanceof GatewayError) throw error; return this.finish(stored, { effectId: input.effectId, attemptId: input.attemptId, outcome: 'unknown-outcome', certainty: 'possible-send', error: this.error('unknown-outcome'), reconciliationRequired: true }); }
    finally { this.release(); }
  }
  async reconcile(effectId: string): Promise<ReconciliationCheckpoint> { const stored = this.#effects.get(effectId) ?? fail('NOT_FOUND'); const receipt = stored.receipt; if (receipt?.outcome !== 'unknown-outcome') return { effectId, attemptId: receipt?.attemptId ?? stored.input.attemptId, state: 'resolved', disposition: 'adopt' }; const outcome = await this.adapter.reconcile?.(Object.freeze(stored.normalized)) ?? 'inconclusive'; if (outcome === 'succeeded') { stored.receipt = { ...receipt, outcome: 'succeeded', certainty: 'confirmed', reconciliationRequired: false }; return { effectId, attemptId: receipt.attemptId, state: 'resolved', disposition: 'adopt' }; } return { effectId, attemptId: receipt.attemptId, state: 'operator-required', disposition: 'await-reconcile' }; }
  attempts(effectId: string): readonly EffectAttempt[] { return [...(this.#effects.get(effectId) ?? fail('NOT_FOUND')).attempts]; }
  private admit(input: CapabilityInvocation): NormalizedInvocation {
    if (!input.id || !input.effectId || !input.attemptId || !input.caseId || !input.idempotencyKey || !input.operation || !input.accountId || !input.resource || !input.authorityCurrent || !input.approvalCurrent || input.generation < 1 || input.budgetRemaining < 1 || Number.isNaN(Date.parse(input.deadline))) fail('DENIED');
    const installation = this.installations.assertInvocable(input.tenantId, input.installationId, input.capability); if (installation.accountId !== input.accountId) fail('DENIED'); this.assertInput(input); const key = this.quotaKey(input) ?? 'shared-unknown-quota'; const now = Date.parse(this.#now()); const recent = (this.#starts.get(key) ?? []).filter((time) => now - time < 60_000); if (recent.length >= this.#perMinute) fail('DENIED'); this.#starts.set(key, [...recent, now]);
    return frozen({ effectId: input.effectId, attemptId: input.attemptId, operation: input.operation, accountId: input.accountId, resource: input.resource, arguments: json(input.arguments) as Record<string, unknown>, deadline: input.deadline, credential: { installationId: input.installationId, scope: input.capability } });
  }
  private async reserve(): Promise<void> { if (this.#inFlight < this.#concurrency) { this.#inFlight += 1; return; } if (this.#waiting.length >= this.#queue) fail('DENIED'); await new Promise<void>((resolve) => { this.#waiting.push(() => { this.#inFlight += 1; resolve(); }); }); }
  private release(): void { this.#inFlight -= 1; this.#waiting.shift()?.(); }
  private finish(stored: StoredEffect, receipt: EffectReceipt): EffectReceipt { stored.receipt = receipt; return receipt; }
  private assertInput(input: CapabilityInvocation): void { const definition = this.installations.definitionFor(input.installationId, input.capability); if (Object.keys(input.arguments).some((key) => !definition.inputKeys.includes(key)) || definition.inputKeys.some((key) => !(key in input.arguments))) fail('INVALID'); }
  private assertOutput(input: CapabilityInvocation, output: Record<string, unknown>): true { const definition = this.installations.definitionFor(input.installationId, input.capability); if (Object.keys(output).some((key) => !definition.outputKeys.includes(key))) fail('INVALID'); return true; }
  private error(outcome: Exclude<AdapterResult['outcome'], 'succeeded'>, retryAfterSeconds?: number): NormalizedError { const category = outcome === 'unknown-outcome' ? 'unknown-outcome' : outcome === 'throttled' ? 'retryable' : outcome === 'retryable' ? 'retryable' : 'denied'; return { category, code: outcome.toUpperCase().replace('-', '_'), message: 'Capability request was not accepted.', redacted: true, ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) }; }
}
