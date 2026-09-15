import { canonicalJson, digest, tenantId, type TenantId } from '../../contracts/src/index.js';

export class DeploymentError extends Error {
  constructor(public readonly code: 'CONFLICT' | 'DENIED' | 'INVALID' | 'NOT_FOUND' | 'STALE') {
    super('Deployment request was not accepted.');
    this.name = 'DeploymentError';
  }
}

const fail = (code: DeploymentError['code']): never => { throw new DeploymentError(code); };
const sha256 = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const secret = /(?:secret|token|password|authorization|credential(?:value|payload)?)/iu;
const safe = (value: unknown): boolean => value === null || typeof value !== 'object'
  ? typeof value !== 'string' || !/(?:bearer\s+|-----begin)/iu.test(value)
  : Array.isArray(value) ? value.every(safe)
    : Object.entries(value as Record<string, unknown>).every(([key, child]) => !secret.test(key) && safe(child));
const frozen = <Value>(value: Value): Value => Object.freeze(JSON.parse(canonicalJson(value)) as Value);

export interface FoundationResource {
  id: string;
  kind: 'repository' | 'workflow-history' | 'key-vault-reference' | 'storage' | 'sql';
  privateIngress: boolean;
  roles: readonly ('reader' | 'writer' | 'backup' | 'restore')[];
  backupCovered: boolean;
}
export interface RestoreInventory {
  tenantId: string;
  quarantine: boolean;
  resources: readonly string[];
  activeStateUntouched: boolean;
}
export interface FoundationEvidence { tenantId: TenantId; resourceDigest: string; restoreDigest: string; digest: string; }

/** Contract-shaped local Azure foundation adapter. It never accepts secret material or active-state restores. */
export async function validateFoundation(input: { tenantId: string; resources: readonly FoundationResource[]; restore: RestoreInventory; configuration: Record<string, unknown> }): Promise<FoundationEvidence> {
  const tenant = tenantId(input.tenantId);
  if (!safe(input.configuration) || !input.resources.length || new Set(input.resources.map((item) => item.id)).size !== input.resources.length) fail('DENIED');
  if (input.resources.some((item) => !item.id || !item.privateIngress || !item.backupCovered || !item.roles.length || item.roles.includes('writer') && item.roles.includes('restore'))) fail('DENIED');
  if (input.restore.tenantId !== tenant || !input.restore.quarantine || !input.restore.activeStateUntouched || !input.restore.resources.length || input.restore.resources.some((id) => !input.resources.some((resource) => resource.id === id))) fail('DENIED');
  const resourceDigest = await digest(input.resources);
  const restoreDigest = await digest({ ...input.restore, tenantId: String(tenant) });
  const base = { tenantId: tenant, resourceDigest, restoreDigest };
  return frozen({ ...base, digest: await digest({ ...base, tenantId: String(tenant) }) });
}

export interface ComputeRequest {
  tenantId: string;
  correlationId: string;
  kind: 'worker' | 'extension-job';
  ingress: string;
  identity: string;
  network: readonly string[];
  cpuMillis: number;
  diagnostics: Record<string, unknown>;
  costUsd: number;
}
export interface ComputeEvidence { tenantId: TenantId; audit: { correlationId: string; outcome: 'completed' }; diagnostics: Record<string, unknown>; costUsd: number; digest: string; }

/** The execute port exposes no ambient identity, metadata, host, or network handles to the work callback. */
export async function runCompute(input: ComputeRequest, execute: () => Promise<void> | void): Promise<ComputeEvidence> {
  const tenant = tenantId(input.tenantId);
  if (!input.correlationId || input.ingress !== 'internal' || input.identity !== 'managed' || input.network.length || !Number.isSafeInteger(input.cpuMillis) || input.cpuMillis < 1 || input.cpuMillis > 2_000 || !Number.isFinite(input.costUsd) || input.costUsd < 0 || !safe(input.diagnostics)) fail('DENIED');
  await execute();
  const base = { tenantId: tenant, audit: { correlationId: input.correlationId, outcome: 'completed' as const }, diagnostics: frozen(input.diagnostics), costUsd: input.costUsd };
  return frozen({ ...base, digest: await digest({ ...base, tenantId: String(tenant) }) });
}

export interface DeploymentArtifact { app: string; package: string; migration: string; sbom: string; provenance: string; }
export interface DeploymentManifest {
  id: string;
  environment: string;
  generation: number;
  artifacts: DeploymentArtifact;
  configurationDigest: string;
  secretReferenceVersions: readonly string[];
  resources: readonly string[];
  leaseExpiresAt: string;
  rollback: Readonly<Record<'app' | 'config' | 'data' | 'package' | 'provider', 'forward' | 'reversible' | 'reconcile'>>;
  digest: string;
}

/** Build-once deployment director: trusted OIDC plus a generation fence create immutable manifests. */
export class DeploymentDirector {
  #generation = 0;
  readonly #manifests = new Map<string, DeploymentManifest>();

  async deploy(input: { id: string; environment: string; expectedGeneration: number; oidc: { trusted: boolean; subject: string }; artifacts: DeploymentArtifact; configurationDigest: string; configuration: Record<string, unknown>; secretReferenceVersions: readonly string[]; resources: readonly string[]; leaseExpiresAt: string; migration: { compatible: boolean; checkpoint: string; backedUp: boolean }; checks: { health: boolean; contracts: boolean; security: boolean } }): Promise<DeploymentManifest> {
    const leaseExpiry = Date.parse(input.leaseExpiresAt);
    if (!input.id || !input.environment || !input.oidc.trusted || !input.oidc.subject.startsWith(`repo:protected/${input.environment}:`) || input.expectedGeneration !== this.#generation || !Object.values(input.artifacts).every(sha256) || !sha256(input.configurationDigest) || !safe(input.configuration) || !input.secretReferenceVersions.length || input.secretReferenceVersions.some((item) => !item || secret.test(item)) || !input.resources.length || !Number.isFinite(leaseExpiry) || leaseExpiry <= Date.now() || !input.migration.compatible || !input.migration.checkpoint || !input.migration.backedUp || !Object.values(input.checks).every(Boolean)) fail('DENIED');
    const existing = this.#manifests.get(input.id); if (existing !== undefined) fail('CONFLICT');
    const base = { id: input.id, environment: input.environment, generation: ++this.#generation, artifacts: frozen(input.artifacts), configurationDigest: input.configurationDigest, secretReferenceVersions: Object.freeze([...input.secretReferenceVersions].sort()), resources: Object.freeze([...new Set(input.resources)].sort()), leaseExpiresAt: input.leaseExpiresAt, rollback: frozen({ app: 'reversible' as const, config: 'reversible' as const, data: 'forward' as const, package: 'reversible' as const, provider: 'reconcile' as const }) };
    const manifest = frozen({ ...base, digest: await digest(base) }); this.#manifests.set(manifest.id, manifest); return manifest;
  }

  manifest(id: string): DeploymentManifest { return this.#manifests.get(id) ?? fail('NOT_FOUND'); }
}

export interface RecoveryEvidence { fault: 'worker' | 'queue' | 'data' | 'telemetry' | 'deployment' | 'migration'; state: 'recovered' | 'quarantined'; rpoMinutes: number; rtoMinutes: number; digest: string; }

export async function exerciseRecovery(input: { manifest: DeploymentManifest; tenantId: string; fault: RecoveryEvidence['fault']; duplicateEffects: boolean; quarantine: boolean; backupTenantId: string; rpoMinutes: number; rtoMinutes: number; rollbackVectorMatches: boolean }): Promise<RecoveryEvidence> {
  const tenant = tenantId(input.tenantId);
  if (!input.manifest.digest || input.duplicateEffects || !input.quarantine || input.backupTenantId !== tenant || input.rpoMinutes < 0 || input.rpoMinutes > 15 || input.rtoMinutes < 0 || input.rtoMinutes > 60 || !input.rollbackVectorMatches) fail('DENIED');
  const base = { fault: input.fault, state: 'recovered' as const, rpoMinutes: input.rpoMinutes, rtoMinutes: input.rtoMinutes };
  return frozen({ ...base, digest: await digest({ ...base, manifest: input.manifest.digest, tenantId: String(tenant) }) });
}

export interface TeardownReceipt { manifestId: string; state: 'closed' | 'resume-required' | 'blocked'; deleted: readonly string[]; retained: readonly string[]; digest: string; }

/** Exact-manifest close gate; broad or held targets do not reach a deletion adapter. */
export async function closeEnvironment(input: { manifest: DeploymentManifest; authorized: boolean; admissionDisabled: boolean; reconciled: boolean; evidenceExported: boolean; targets: readonly string[]; heldEvidence?: readonly string[]; interrupted?: boolean; now?: number }): Promise<TeardownReceipt> {
  const now = input.now ?? Date.now();
  const leaseExpiry = Date.parse(input.manifest.leaseExpiresAt);
  if (!input.authorized || !input.admissionDisabled || !input.reconciled || !input.evidenceExported || !Number.isFinite(leaseExpiry) || leaseExpiry < now || input.targets.length !== input.manifest.resources.length || input.targets.some((target) => !input.manifest.resources.includes(target)) || new Set(input.targets).size !== input.targets.length) fail('DENIED');
  const retained = Object.freeze([...(input.heldEvidence ?? [])].sort());
  const state: TeardownReceipt['state'] = retained.length ? 'blocked' : input.interrupted ? 'resume-required' : 'closed';
  const deleted = Object.freeze(state === 'closed' ? [...input.targets].sort() : []);
  const base = { manifestId: input.manifest.id, state, deleted, retained };
  return frozen({ ...base, digest: await digest(base) });
}

export const CERTIFICATION_CASES = Object.freeze(['allow', 'deny', 'pagination', 'throttle', 'idempotency', 'timeout', 'reconciliation', 'credential', 'reset'] as const);
export type CertificationCase = typeof CERTIFICATION_CASES[number];
export interface ProviderCertificationAdapter { provider: string; apiVersion: string; authVersion: string; schemaVersion: string; invoke(test: CertificationCase): Promise<{ outcome: CertificationCase }> | { outcome: CertificationCase }; }
export interface LiveManifest { provider: string; apiVersion: string; authVersion: string; schemaVersion: string; recordedAt: string; expiresAt: string; classification: string; recording: Record<string, unknown>; }
export interface CertificationEvidence { provider: string; classification: 'fixture' | 'live'; cases: readonly CertificationCase[]; digest: string; }

/** Shared fake/live suite. A live label is accepted only through an injected trusted verifier. */
export class ProviderCertificationHarness {
  constructor(private readonly verifyLive: (manifest: LiveManifest) => Promise<boolean> | boolean = () => false, private readonly now: () => number = Date.now) {}

  async certify(adapter: ProviderCertificationAdapter, live?: LiveManifest): Promise<CertificationEvidence> {
    if (!adapter.provider || !adapter.apiVersion || !adapter.authVersion || !adapter.schemaVersion) fail('INVALID');
    const results = await Promise.all(CERTIFICATION_CASES.map(async (test) => (await adapter.invoke(test)).outcome === test));
    if (results.some((result) => !result)) fail('DENIED');
    let classification: CertificationEvidence['classification'] = 'fixture';
    if (live !== undefined) {
      if (live.classification !== 'live' || live.provider !== adapter.provider || live.apiVersion !== adapter.apiVersion || live.authVersion !== adapter.authVersion || live.schemaVersion !== adapter.schemaVersion || Date.parse(live.recordedAt) > this.now() || Date.parse(live.expiresAt) <= this.now() || !safe(live.recording) || !await this.verifyLive(live)) fail('DENIED');
      classification = 'live';
    }
    const base = { provider: adapter.provider, classification, cases: CERTIFICATION_CASES };
    return frozen({ ...base, digest: await digest(base) });
  }
}
