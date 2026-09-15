import { canonicalJson, digest, tenantId, type EvidenceClassification, type TenantId } from '../../contracts/src/index.js';
import { MemoryError, ProvenanceGraph, type MemoryScope, type ProvenanceInput } from './index.js';

const fail = (code: ConstructorParameters<typeof MemoryError>[0]): never => { throw new MemoryError(code); };
const same = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);

export type LifecycleKind = 'record' | 'derivative' | 'index' | 'cache' | 'dataset' | 'experience' | 'export' | 'backup';
export type LifecycleDisposition = 'deleted' | 'logically-withheld' | 'held' | 'deferred-until' | 'not-found' | 'error';
export interface LifecycleManifestItem { id: string; kind: LifecycleKind; }
export interface LifecycleReport { id: string; tenantId: TenantId; manifest: readonly LifecycleManifestItem[]; dispositions: Readonly<Record<string, LifecycleDisposition>>; complete: boolean; digest: string; }
export interface LegalHold { id: string; tenantId: TenantId; provenanceIds: readonly string[]; expiresAt: string; }

/** Coordinates exact, append-only memory lifecycle decisions; storage adapters retain physical deletion receipts. */
export class GovernedMemoryLifecycle {
  readonly #holds = new Map<string, LegalHold>(); readonly #heldStatuses = new Map<string, ReadonlyMap<string, ReturnType<ProvenanceGraph['currentStatus']>>>(); readonly #reports = new Map<string, LifecycleReport>();
  constructor(private readonly graph: ProvenanceGraph) {}

  correct(input: { replacedId: string; replacement: ProvenanceInput; authorized: boolean }): { replacementId: string; descendants: readonly string[] } {
    const replaced = this.graph.record(input.replacedId); if (!input.authorized || replaced.tenantId !== tenantId(input.replacement.tenantId) || !same(replaced.scope, input.replacement.scope) || replaced.purpose !== input.replacement.purpose) fail('DENIED');
    const replacement = this.graph.add(input.replacement); this.graph.status(replaced.id, 'corrected'); return Object.freeze({ replacementId: replacement.id, descendants: this.graph.descendants(replaced.id) });
  }

  delete(input: { tenantId: string; manifest: readonly LifecycleManifestItem[]; authorized: boolean }): LifecycleReport {
    const scopedTenant = tenantId(input.tenantId); if (!input.authorized || !input.manifest.length || new Set(input.manifest.map((item) => item.id)).size !== input.manifest.length || input.manifest.some((item) => !item.id)) fail('INVALID');
    const dispositions: Record<string, LifecycleDisposition> = {};
    for (const item of input.manifest) {
      const record = this.graph.record(item.id); if (record.tenantId !== scopedTenant) fail('DENIED'); if (this.graph.currentStatus(item.id) === 'held') fail('DENIED'); this.graph.status(item.id, 'deleted'); dispositions[item.id] = 'deleted';
    }
    const manifest = Object.freeze(input.manifest.map((item) => Object.freeze({ ...item }))); const report: LifecycleReport = Object.freeze({ id: `deletion-${String(this.#reports.size + 1)}`, tenantId: scopedTenant, manifest, dispositions: Object.freeze({ ...dispositions }), complete: true, digest: canonicalJson({ manifest, dispositions }) }); this.#reports.set(report.id, report); return report;
  }

  hold(input: Omit<LegalHold, 'tenantId'> & { tenantId: string; authorized: boolean }): LegalHold {
    const hold: LegalHold = { id: input.id, tenantId: tenantId(input.tenantId), provenanceIds: Object.freeze([...new Set(input.provenanceIds)].sort()), expiresAt: input.expiresAt };
    if (!input.authorized || !hold.id || !hold.provenanceIds.length || this.#holds.has(hold.id) || Number.isNaN(Date.parse(hold.expiresAt))) fail('INVALID');
    const previous = new Map<string, ReturnType<ProvenanceGraph['currentStatus']>>();
    for (const id of hold.provenanceIds) { if (this.graph.record(id).tenantId !== hold.tenantId) fail('DENIED'); for (const affected of [id, ...this.graph.descendants(id)]) { previous.set(affected, this.graph.currentStatus(affected)); this.graph.status(affected, 'held'); } }
    this.#heldStatuses.set(hold.id, previous);
    const immutable = Object.freeze(hold); this.#holds.set(immutable.id, immutable); return immutable;
  }

  releaseHold(id: string, authorized: boolean): void { const hold = this.#holds.get(id) ?? fail('NOT_FOUND'); const previous = this.#heldStatuses.get(id) ?? fail('NOT_FOUND'); if (!authorized) fail('DENIED'); for (const [provenanceId, status] of previous) { if (this.graph.currentStatus(provenanceId) !== 'held') continue; if (status === 'eligible') this.graph.release(provenanceId); else this.graph.status(provenanceId, status); } this.#heldStatuses.delete(id); this.#holds.delete(hold.id); }

  restore(input: { tenantId: string; provenanceIds: readonly string[]; policyCurrent: boolean; residueAbsent: boolean; authorized: boolean }): { state: 'restored' | 'quarantined'; provenanceIds: readonly string[] } {
    const scopedTenant = tenantId(input.tenantId); if (!input.authorized || !input.provenanceIds.length) fail('DENIED'); for (const id of input.provenanceIds) { if (this.graph.record(id).tenantId !== scopedTenant || !['deleted', 'expired'].includes(this.graph.currentStatus(id))) fail('DENIED'); this.graph.status(id, 'quarantined'); }
    if (!input.policyCurrent || !input.residueAbsent) return Object.freeze({ state: 'quarantined', provenanceIds: Object.freeze([...input.provenanceIds]) });
    for (const id of input.provenanceIds) this.graph.release(id); return Object.freeze({ state: 'restored', provenanceIds: Object.freeze([...input.provenanceIds]) });
  }
}

export type ExperienceStatus = 'evidence-ready' | 'approved' | 'rejected' | 'superseded' | 'expired' | 'withdrawn' | 'rolled-back';
export interface ValidatedExperience { id: string; tenantId: TenantId; authorId: string; scope: MemoryScope; provenanceIds: readonly string[]; evidenceIds: readonly string[]; classification: EvidenceClassification; fingerprint: string; expiresAt: string; digest: string; status: ExperienceStatus; timeline: readonly { status: ExperienceStatus; actorId: string; at: string }[]; }

/** Approved experiences are immutable snapshots; status is append-only provenance, never a content edit. */
export class ValidatedExperienceRegistry {
  readonly #experiences = new Map<string, ValidatedExperience>(); readonly #fingerprints = new Map<string, string>();
  constructor(private readonly graph: ProvenanceGraph, private readonly now: () => string = () => new Date().toISOString()) {}
  async create(input: Omit<ValidatedExperience, 'tenantId' | 'scope' | 'digest' | 'status' | 'timeline'> & { tenantId: string; scope: MemoryScope }): Promise<ValidatedExperience> {
    const scopedTenant = tenantId(input.tenantId); if (!input.id || !input.authorId || !input.fingerprint || !input.provenanceIds.length || !input.evidenceIds.length || this.#experiences.has(input.id) || Number.isNaN(Date.parse(input.expiresAt))) fail('INVALID');
    for (const provenanceId of input.provenanceIds) { const source = this.graph.record(provenanceId); if (source.tenantId !== scopedTenant || !this.graph.eligible(provenanceId) || !same(source.scope, input.scope)) fail('DENIED'); }
    if (this.#fingerprints.has(input.fingerprint)) fail('CONFLICT');
    const base = { ...input, tenantId: scopedTenant, provenanceIds: Object.freeze([...new Set(input.provenanceIds)].sort()), evidenceIds: Object.freeze([...new Set(input.evidenceIds)].sort()), status: 'evidence-ready' as const, timeline: Object.freeze([{ status: 'evidence-ready' as const, actorId: input.authorId, at: this.now() }]) };
    const experience = Object.freeze({ ...base, digest: await digest({ ...base, tenantId: String(scopedTenant) }) }); this.#experiences.set(experience.id, experience); this.#fingerprints.set(experience.fingerprint, experience.id); return experience;
  }
  review(input: { candidateId: string; reviewerId: string; authorityCurrent: boolean; evidenceCurrent: boolean; redactionPassed: boolean; scopeReviewed: boolean; approve: boolean }): ValidatedExperience {
    const current = this.#experiences.get(input.candidateId) ?? fail('NOT_FOUND'); if (current.status !== 'evidence-ready' || !input.reviewerId || input.reviewerId === current.authorId || !input.authorityCurrent) fail('DENIED');
    const approved = input.approve && input.evidenceCurrent && input.redactionPassed && input.scopeReviewed && current.provenanceIds.every((id) => this.graph.eligible(id)); const status: ExperienceStatus = approved ? 'approved' : 'rejected';
    const next = Object.freeze({ ...current, status, timeline: Object.freeze([...current.timeline, { status, actorId: input.reviewerId, at: this.now() }]) }); this.#experiences.set(next.id, next); return next;
  }
  status(id: string, nextStatus: Exclude<ExperienceStatus, 'evidence-ready' | 'approved' | 'rejected'>, actorId: string): ValidatedExperience { const current = this.#experiences.get(id) ?? fail('NOT_FOUND'); if (!actorId) fail('DENIED'); const next = Object.freeze({ ...current, status: nextStatus, timeline: Object.freeze([...current.timeline, { status: nextStatus, actorId, at: this.now() }]) }); this.#experiences.set(id, next); return next; }
}
