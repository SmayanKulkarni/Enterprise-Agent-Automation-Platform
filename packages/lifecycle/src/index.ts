import { canonicalJson, digest, tenantId, type TenantId } from '../../contracts/src/index.js';

export class LifecycleError extends Error { constructor(public readonly code: 'CONFLICT' | 'DENIED' | 'INVALID' | 'NOT_FOUND' | 'STALE') { super('Lifecycle request was not accepted.'); this.name = 'LifecycleError'; } }
const fail = (code: LifecycleError['code']): never => { throw new LifecycleError(code); };
const validDigest = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const frozen = <Value>(value: Value): Value => Object.freeze(JSON.parse(canonicalJson(value)) as Value);
const safeContent = (value: unknown): boolean => value === null || typeof value !== 'object' ? true : Array.isArray(value) ? value.every(safeContent) : Object.entries(value as Record<string, unknown>).every(([key, child]) => !/secret|token|password|executable/iu.test(key) && safeContent(child));

export interface PackageArtifact { id: string; version: string; digest: string; kind: 'agent' | 'skill' | 'workflow' | 'evaluation' | 'documentation'; content: Record<string, unknown>; }
export interface PackageDraft { id: string; version: string; author: string; artifacts: readonly PackageArtifact[]; dependencies: readonly { id: string; version: string; digest: string }[]; bindings: readonly string[]; overlayPaths: readonly string[]; }
export interface ResolvedPackage { draft: PackageDraft; lock: readonly { id: string; version: string; digest: string }[]; overlay: Record<string, unknown>; digest: string; lockDigest: string; }
export interface ValidationResult { packageDigest: string; lockDigest: string; gateDigest: string; valid: boolean; reason: string; }
export interface Signature { signer: string; keyId: string; packageDigest: string; lockDigest: string; gateDigest: string; digest: string; revoked: boolean; }
export interface Publication { packageId: string; version: string; digest: string; tenantIds: readonly TenantId[]; signature: Signature; }
export interface Readiness { digest: string; epochs: Readonly<Record<string, number>>; ready: boolean; }
export interface Activation { id: string; tenantId: TenantId; installationId: string; packageDigest: string; readinessDigest: string; revision: number; }
export interface MigrationCheckpoint { id: string; checkpoint: string; state: 'completed' | 'recovery-required'; reversible: boolean; }
export interface ActivationChange { id: string; activationId: string; revision: number; state: 'upgraded' | 'rolled-back' | 'quarantined'; runningCaseDisposition: 'pin-current' | 'pause-and-recover' | 'terminate'; }

/** In-memory deterministic lifecycle seam: immutable authoring, resolution, trust and activation. */
export class SolutionLifecycle {
  readonly #drafts = new Map<string, PackageDraft>(); readonly #resolved = new Map<string, ResolvedPackage>(); readonly #validations = new Map<string, ValidationResult>(); readonly #publications = new Map<string, Publication>(); readonly #installations = new Map<string, { tenantId: TenantId; packageDigest: string; readiness: Readiness; version: number }>(); readonly #activations = new Map<string, Activation>(); readonly #commands = new Map<string, Activation>(); readonly #current = new Map<TenantId, string>(); readonly #revoked = new Set<string>(); readonly #migrations = new Map<string, MigrationCheckpoint>(); readonly #changes = new Map<string, ActivationChange>(); readonly #holds = new Set<string>();

  author(input: PackageDraft): PackageDraft {
    if (!input.id || !input.version || !input.author || !input.artifacts.length || this.#drafts.has(`${input.id}@${input.version}`) || new Set(input.artifacts.map((artifact) => artifact.id)).size !== input.artifacts.length || input.artifacts.some((artifact) => !artifact.id || !artifact.version || !validDigest(artifact.digest) || !safeContent(artifact.content))) fail('INVALID');
    const draft = frozen({ ...input, artifacts: [...input.artifacts].sort((a, b) => a.id.localeCompare(b.id)), dependencies: [...input.dependencies].sort((a, b) => a.id.localeCompare(b.id)), bindings: [...new Set(input.bindings)].sort(), overlayPaths: [...new Set(input.overlayPaths)].sort() }); this.#drafts.set(`${draft.id}@${draft.version}`, draft); return draft;
  }
  async resolve(id: string, version: string, overlay: Record<string, unknown> = {}): Promise<ResolvedPackage> {
    const draft = this.#drafts.get(`${id}@${version}`) ?? fail('NOT_FOUND'); const lock = draft.dependencies;
    if (new Set(lock.map((dependency) => dependency.id)).size !== lock.length || lock.some((dependency) => !dependency.id || !dependency.version || !validDigest(dependency.digest) || this.#revoked.has(dependency.digest)) || Object.keys(overlay).some((path) => !draft.overlayPaths.includes(path) || /artifact|schema|signature|approver|risk|audit|gateway/iu.test(path))) fail('DENIED');
    const lockDigest = await digest(lock); const resolved = frozen({ draft, lock, overlay, lockDigest, digest: await digest({ draft, lock, overlay, lockDigest }) }); this.#resolved.set(resolved.digest, resolved); return resolved;
  }
  async validate(packageDigest: string, gates: { hardPassed: boolean; evidenceCurrent: boolean; comparable: boolean; liveCertified: boolean; subjectDigest: string }): Promise<ValidationResult> {
    const resolved = this.#resolved.get(packageDigest) ?? fail('NOT_FOUND'); const valid = gates.hardPassed && gates.evidenceCurrent && gates.comparable && gates.liveCertified && gates.subjectDigest === packageDigest;
    const result = frozen({ packageDigest, lockDigest: resolved.lockDigest, gateDigest: await digest(gates), valid, reason: valid ? 'passed' : 'gate-failed' }); this.#validations.set(packageDigest, result); return result;
  }
  async publish(input: { packageDigest: string; approver: string; signer: string; publisher: string; keyId: string; tenantIds: readonly string[] }): Promise<Publication> {
    const resolved = this.#resolved.get(input.packageDigest) ?? fail('NOT_FOUND'); const validation = this.#validations.get(input.packageDigest) ?? fail('DENIED'); if (!validation.valid || !input.approver || !input.signer || !input.publisher || new Set([resolved.draft.author, input.approver, input.signer, input.publisher]).size !== 4 || this.#revoked.has(input.packageDigest)) fail('DENIED');
    const signature = frozen({ signer: input.signer, keyId: input.keyId, packageDigest: input.packageDigest, lockDigest: resolved.lockDigest, gateDigest: validation.gateDigest, digest: await digest({ signer: input.signer, keyId: input.keyId, packageDigest: input.packageDigest, lockDigest: resolved.lockDigest, gateDigest: validation.gateDigest }), revoked: false });
    const key = `${resolved.draft.id}@${resolved.draft.version}`; const existing = this.#publications.get(key); if (existing !== undefined && existing.digest !== input.packageDigest) fail('CONFLICT'); const publication = frozen({ packageId: resolved.draft.id, version: resolved.draft.version, digest: input.packageDigest, tenantIds: input.tenantIds.map(tenantId).sort(), signature }); this.#publications.set(key, publication); return publication;
  }
  discover(tenant: string): readonly Publication[] { const scoped = tenantId(tenant); return Object.freeze([...this.#publications.values()].filter((publication) => publication.tenantIds.includes(scoped) && !publication.signature.revoked && !this.#revoked.has(publication.digest))); }
  revoke(packageDigest: string): void { this.#revoked.add(packageDigest); }
  async install(input: { id: string; tenantId: string; packageDigest: string; epochs: Record<string, number>; checksCurrent: boolean }): Promise<Readiness> {
    const scoped = tenantId(input.tenantId); if (!input.id || !this.discover(String(scoped)).some((publication) => publication.digest === input.packageDigest) || this.#revoked.has(input.packageDigest) || !input.checksCurrent || Object.values(input.epochs).some((epoch) => !Number.isSafeInteger(epoch) || epoch < 1)) fail('DENIED');
    const readiness = frozen({ digest: await digest({ tenantId: String(scoped), packageDigest: input.packageDigest, epochs: input.epochs }), epochs: input.epochs, ready: true }); const current = this.#installations.get(input.id); if (current !== undefined && (current.tenantId !== scoped || current.packageDigest !== input.packageDigest)) fail('CONFLICT'); this.#installations.set(input.id, { tenantId: scoped, packageDigest: input.packageDigest, readiness, version: (current?.version ?? 0) + 1 }); return readiness;
  }
  activate(input: { idempotencyKey: string; id: string; tenantId: string; installationId: string; readinessDigest: string; expectedVersion: number }): Activation {
    const cached = this.#commands.get(input.idempotencyKey); if (cached !== undefined) return cached; const scoped = tenantId(input.tenantId); const installation = this.#installations.get(input.installationId) ?? fail('NOT_FOUND'); if (!input.idempotencyKey || installation.tenantId !== scoped || installation.version !== input.expectedVersion || !installation.readiness.ready || installation.readiness.digest !== input.readinessDigest || this.#revoked.has(installation.packageDigest)) fail('STALE');
    const activation = frozen({ id: input.id, tenantId: scoped, installationId: input.installationId, packageDigest: installation.packageDigest, readinessDigest: input.readinessDigest, revision: this.#activations.size + 1 }); this.#activations.set(activation.id, activation); this.#current.set(scoped, activation.id); this.#commands.set(input.idempotencyKey, activation); return activation;
  }
  changeActivation(input: { id: string; tenantId: string; fromActivationId: string; toActivationId: string; expectedRevision: number; migration: { id: string; reversible: boolean; compatible: boolean; checkpoint: string }; runningCaseDisposition: ActivationChange['runningCaseDisposition'] }): ActivationChange {
    const previous = this.pin(input.fromActivationId, input.tenantId); const next = this.pin(input.toActivationId, input.tenantId);
    if (!input.id || previous.revision !== input.expectedRevision || !input.migration.id || !input.migration.checkpoint || !input.migration.compatible || this.#changes.has(input.id)) fail('STALE');
    const migration = frozen({ id: input.migration.id, checkpoint: input.migration.checkpoint, state: 'completed' as const, reversible: input.migration.reversible }); this.#migrations.set(migration.id, migration);
    const change = frozen({ id: input.id, activationId: next.id, revision: previous.revision + 1, state: 'upgraded' as const, runningCaseDisposition: input.runningCaseDisposition }); this.#current.set(next.tenantId, next.id); this.#changes.set(change.id, change); return change;
  }
  migration(id: string, checkpoint: string): MigrationCheckpoint { const migration = this.#migrations.get(id) ?? fail('NOT_FOUND'); if (migration.checkpoint !== checkpoint) fail('DENIED'); return migration; }
  rollback(input: { id: string; tenantId: string; activationId: string; expectedRevision: number; runningCaseDisposition: ActivationChange['runningCaseDisposition'] }): ActivationChange {
    const activation = this.pin(input.activationId, input.tenantId); if (!input.id || input.expectedRevision < activation.revision || this.#changes.has(input.id)) fail('STALE'); const change = frozen({ id: input.id, activationId: activation.id, revision: input.expectedRevision + 1, state: 'rolled-back' as const, runningCaseDisposition: input.runningCaseDisposition }); this.#current.set(activation.tenantId, activation.id); this.#changes.set(change.id, change); return change;
  }
  quarantine(packageDigest: string, reason: 'compromised' | 'rollback-ambiguous' | 'migration-failed'): ActivationChange { if (!this.#resolved.has(packageDigest)) fail('NOT_FOUND'); this.#revoked.add(packageDigest); const change = frozen({ id: `quarantine:${reason}:${packageDigest}`, activationId: '', revision: 0, state: 'quarantined' as const, runningCaseDisposition: 'pause-and-recover' as const }); this.#changes.set(change.id, change); return change; }
  hold(packageDigest: string): void { if (!this.#resolved.has(packageDigest)) fail('NOT_FOUND'); this.#holds.add(packageDigest); }
  retire(packageDigest: string): void { if (!this.#resolved.has(packageDigest) || this.#holds.has(packageDigest)) fail('DENIED'); this.#revoked.add(packageDigest); }
  active(tenant: string): Activation { const scoped = tenantId(tenant); return this.pin(this.#current.get(scoped) ?? fail('NOT_FOUND'), tenant); }
  pin(activationId: string, tenant: string): Activation { const activation = this.#activations.get(activationId) ?? fail('NOT_FOUND'); if (activation.tenantId !== tenantId(tenant) || this.#revoked.has(activation.packageDigest)) fail('DENIED'); return activation; }
}
