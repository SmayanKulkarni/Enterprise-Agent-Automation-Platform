import { canonicalJson, decodeContract, descriptorFor, type ContractEnvelope } from '../../contracts/src/index.js';
import { SolutionLifecycle, type Activation } from '../../lifecycle/src/index.js';

type Completeness = 'complete' | 'partial';
type SafeRecord = Readonly<Record<string, unknown>>;
export interface OperationsQuery { tenantId: string; cursor?: string; }
export interface OperationsSnapshot { tenantId: string; calculatedAt: string; completeness: Completeness; watermark: number; sourceVersions: readonly string[]; records: readonly SafeRecord[]; cursor: string; cost?: { basis: 'estimated' | 'final' | 'unknown' | 'shared'; amount?: number; currency: string; rateVersion: string }; }
interface AcceptedEvent { eventId: string; tenantId: string; producer: string; ownerSequence: number; sourceVersion: string; projection: SafeRecord; bytes: string; }
interface AuditEvidence { tenantId: string; id: string; classification: 'immutable-audit'; correlationId: string; action: string; }

const forbidden = /(?:token|secret|password|credential(?:bytes|value|payload)|payload)/iu;
const safe = (value: unknown): value is Record<string, unknown> => value !== null && !Array.isArray(value) && typeof value === 'object' && Object.entries(value).every(([key, child]) => !forbidden.test(key) && (child === null || typeof child !== 'object' || Array.isArray(child) ? !Array.isArray(child) || child.every((item) => item === null || typeof item !== 'object' || safe(item)) : safe(child)));
const copy = <Value>(value: Value): Value => Object.freeze(JSON.parse(canonicalJson(value)) as Value);
const fail = (code: string): never => { throw Object.assign(new Error('Operations request was not accepted.'), { code }); };

/** Validates owner events before they can become a Tenant-visible projection. */
export class OperationsRuntime {
  readonly #events = new Map<string, AcceptedEvent>(); readonly #quarantine: { code: string; eventId: string; tenantId: string }[] = []; readonly #audits = new Map<string, AuditEvidence>(); readonly #costs = new Map<string, NonNullable<OperationsSnapshot['cost']>>(); readonly #commands = new Map<string, { digest: string; receipt: Readonly<Record<string, unknown>> }>(); readonly #alerts = new Map<string, 'fired' | 'cleared'>();
  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  ingest(bytes: Uint8Array): { state: 'accepted' | 'duplicate' | 'quarantined'; eventId: string } {
    let envelope: ContractEnvelope;
    try { envelope = decodeContract(descriptorFor('operations.event'), bytes); } catch { return { state: 'quarantined', eventId: 'unreadable' }; }
    const eventId = String(envelope.messageId); const tenantId = String(envelope.tenantId ?? ''); const payload = envelope.payload; const sequence = payload['ownerSequence']; const projection = payload['safeProjection'];
    if (!tenantId || envelope.correlationId === undefined || envelope.causationId === undefined || !Number.isSafeInteger(sequence) || (sequence as number) < 1 || !safe(projection) || Object.keys(payload).some((key) => !['ownerSequence', 'safeProjection', 'evidenceId'].includes(key))) return this.quarantineEvent('UNSAFE_PROJECTION', eventId, tenantId);
    const key = `${envelope.sender}:${eventId}`; const accepted: AcceptedEvent = { eventId, tenantId, producer: envelope.sender, ownerSequence: sequence as number, sourceVersion: envelope.contractVersion, projection: copy(projection), bytes: canonicalJson(envelope) };
    const existing = this.#events.get(key); if (existing !== undefined) return existing.bytes === accepted.bytes ? { state: 'duplicate', eventId } : this.quarantineEvent('CONFLICTING_DUPLICATE', eventId, tenantId);
    this.#events.set(key, accepted); return { state: 'accepted', eventId };
  }
  private quarantineEvent(code: string, eventId: string, tenantId: string): { state: 'quarantined'; eventId: string } { this.#quarantine.push(Object.freeze({ code, eventId, tenantId })); return { state: 'quarantined', eventId }; }
  quarantine(): readonly { code: string; eventId: string; tenantId: string }[] { return Object.freeze([...this.#quarantine]); }
  query(input: OperationsQuery): OperationsSnapshot {
    const events = [...this.#events.values()].filter((event) => event.tenantId === input.tenantId); if (!events.length && !this.#costs.has(input.tenantId) && ![...this.#audits.values()].some((audit) => audit.tenantId === input.tenantId)) fail('DENIED'); if (input.cursor !== undefined && !input.cursor.startsWith(`${input.tenantId}.`)) fail('TENANT_MISMATCH');
    const ordered = events.sort((left, right) => left.producer.localeCompare(right.producer) || left.ownerSequence - right.ownerSequence || left.eventId.localeCompare(right.eventId)); let partial = false; const last = new Map<string, number>();
    for (const event of ordered) { const previous = last.get(event.producer) ?? 0; if (event.ownerSequence !== previous + 1) partial = true; last.set(event.producer, event.ownerSequence); }
    const watermark = ordered.length ? Math.max(...ordered.map((event) => event.ownerSequence)) : 0; const shared = { tenantId: input.tenantId, calculatedAt: this.now(), completeness: partial ? 'partial' as const : 'complete' as const, watermark, sourceVersions: [...new Set(ordered.map((event) => event.sourceVersion))].sort(), records: ordered.map((event) => ({ id: event.eventId, ownerSequence: event.ownerSequence, producer: event.producer, ...event.projection })), cursor: `${input.tenantId}.${String(watermark)}` }; const cost = this.#costs.get(input.tenantId); const snapshot: OperationsSnapshot = cost === undefined ? shared : { ...shared, cost }; return copy(snapshot);
  }
  audit(input: AuditEvidence): void { if (!input.id || !input.correlationId || this.#audits.has(input.id)) fail('INVALID_AUDIT'); this.#audits.set(input.id, copy(input)); }
  cost(input: { tenantId: string; id: string; basis: 'estimated' | 'final' | 'unknown' | 'shared'; amount?: number; currency: string; rateVersion: string }): void { if (!input.id || !input.currency || !input.rateVersion || (input.basis === 'unknown' && input.amount !== undefined) || (input.basis !== 'unknown' && (!Number.isFinite(input.amount) || (input.amount as number) < 0))) fail('INVALID_COST'); this.#costs.set(input.tenantId, copy({ basis: input.basis, ...(input.amount === undefined ? {} : { amount: input.amount }), currency: input.currency, rateVersion: input.rateVersion })); }
  submitOwnerCommand(input: { tenantId: string; owner: string; name: string; idempotencyKey: string; digest: string; expectedVersion: number; authorityCurrent: boolean; approvalCurrent: boolean }, owner: () => Record<string, unknown>): Readonly<Record<string, unknown>> {
    if (!input.tenantId || !input.owner || !input.name || !input.idempotencyKey || !/^[a-f0-9]{64}$/u.test(input.digest) || !Number.isSafeInteger(input.expectedVersion) || !input.authorityCurrent || !input.approvalCurrent) fail('DENIED'); const prior = this.#commands.get(input.idempotencyKey); if (prior !== undefined) { if (prior.digest !== input.digest) fail('CONFLICT'); return prior.receipt; }
    const receipt = copy({ ...owner(), owner: input.owner, name: input.name, projection: 'pending' }); this.#commands.set(input.idempotencyKey, { digest: input.digest, receipt }); return receipt;
  }
  evaluateAlerts(input: { tenantId: string; alertId: string; threshold: number; value: number; runbook: string }): { state: 'fired' | 'grouped' | 'cleared'; runbook: string } { if (!input.tenantId || !input.alertId || !Number.isFinite(input.threshold) || !Number.isFinite(input.value) || !/^runbook:\/\//u.test(input.runbook)) fail('INVALID_ALERT'); const key = `${input.tenantId}:${input.alertId}`; if (input.value < input.threshold) { this.#alerts.set(key, 'cleared'); return { state: 'cleared', runbook: input.runbook }; } const state = this.#alerts.get(key) === 'fired' ? 'grouped' : 'fired'; this.#alerts.set(key, 'fired'); return { state, runbook: input.runbook }; }
}

/** Disposable Mongo-shaped read model: it stores only safe snapshots and rebuilds from owner events. */
export class MongoOperationsReadModel {
  readonly #snapshots = new Map<string, OperationsSnapshot>();
  rebuild(source: OperationsRuntime, tenantId: string): void { this.#snapshots.set(tenantId, source.query({ tenantId })); }
  query(input: OperationsQuery): OperationsSnapshot { const snapshot = this.#snapshots.get(input.tenantId) ?? fail('DENIED'); if (input.cursor !== undefined && !input.cursor.startsWith(`${input.tenantId}.`)) fail('DENIED'); return copy(snapshot); }
  purge(tenantId: string, manifest: readonly string[]): void { const snapshot = this.#snapshots.get(tenantId) ?? fail('NOT_FOUND'); if (manifest.length !== 1 || manifest[0] !== tenantId) fail('DENIED'); this.#snapshots.delete(snapshot.tenantId); }
}

export class OperationsWorkbench {
  #tenantId: string | undefined;
  ingest(input: OperationsSnapshot): OperationsSnapshot { if (!input.tenantId || !Number.isSafeInteger(input.watermark) || !['complete', 'partial'].includes(input.completeness) || input.records.some((record) => !safe(record))) fail('INVALID_BROWSER_DTO'); if (this.#tenantId !== undefined && this.#tenantId !== input.tenantId) this.#tenantId = undefined; this.#tenantId = input.tenantId; return copy(input); }
  command(input: { owner: 'case' | 'gateway' | 'lifecycle' | 'identity' | 'deployment'; name: string; expectedVersion: number; idempotencyKey: string; approvalCurrent: boolean; arguments: Record<string, unknown> }): Readonly<typeof input> { const destructive = ['delete', 'restore', 'teardown', 'quarantine', 'retire']; if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || !input.idempotencyKey || !input.approvalCurrent || (destructive.includes(input.name) && !Array.isArray(input.arguments['manifest']))) fail('INVALID_BROWSER_COMMAND'); return copy(input); }
}

/** Smallest shared-module Technical Implementation package fixture; no solution-specific runtime is introduced. */
export async function technicalImplementationFixture(tenantId: string): Promise<{ activation: Activation }> {
  const lifecycle = new SolutionLifecycle(); const draft = lifecycle.author({ id: 'technical-implementation', version: '1.0.0', author: 'fixture-author', artifacts: [{ id: 'technical-workflow', version: '1.0.0', digest: 'a'.repeat(64), kind: 'workflow', content: { case: 'technical-implementation', team: ['discovery', 'data', 'delivery'], joins: ['parallel-discovery', 'handoff'], budgets: { effects: 3 }, interventions: ['missing-information'], memory: 'governed', evaluation: 'required', capabilities: ['sql.validate', 'blob.write', 'boards.create'] } }], dependencies: [], bindings: ['sql-fixture', 'blob-fixture', 'boards-fixture'], overlayPaths: ['/budget'] });
  const resolved = await lifecycle.resolve(draft.id, draft.version, { '/budget': 3 }); await lifecycle.validate(resolved.digest, { hardPassed: true, evidenceCurrent: true, comparable: true, liveCertified: true, subjectDigest: resolved.digest }); const publication = await lifecycle.publish({ packageDigest: resolved.digest, approver: 'fixture-approver', signer: 'fixture-signer', publisher: 'fixture-publisher', keyId: 'fixture-key', tenantIds: [tenantId] }); const readiness = await lifecycle.install({ id: 'technical-installation', tenantId, packageDigest: publication.digest, epochs: { policy: 1, sql: 1, blob: 1, boards: 1 }, checksCurrent: true }); return { activation: lifecycle.activate({ idempotencyKey: 'technical-activate', id: 'technical-activation', tenantId, installationId: 'technical-installation', readinessDigest: readiness.digest, expectedVersion: 1 }) };
}
