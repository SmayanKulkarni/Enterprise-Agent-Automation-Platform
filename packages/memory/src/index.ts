import { canonicalJson, tenantId, type EvidenceClassification, type TenantId } from '../../contracts/src/index.js';

export class MemoryError extends Error {
  constructor(public readonly code: 'CONFLICT' | 'DENIED' | 'INVALID' | 'NOT_FOUND' | 'UNAVAILABLE') { super('Memory request was not accepted.'); this.name = 'MemoryError'; }
}
const fail = (code: MemoryError['code']): never => { throw new MemoryError(code); };
const copy = <Value>(value: Value): Value => JSON.parse(canonicalJson(value)) as Value;

export type MemoryScope =
  | { kind: 'platform' }
  | { kind: 'tenant'; tenantId: TenantId }
  | { kind: 'case'; tenantId: TenantId; caseId: string; generation: number }
  | { kind: 'activation'; tenantId: TenantId; activationId: string }
  | { kind: 'agent'; tenantId: TenantId; activationId: string; agentId: string };
export type MemoryScopeInput = { kind: MemoryScope['kind']; tenantId?: string; caseId?: string; generation?: number; activationId?: string; agentId?: string };
export type ProvenanceStatus = 'eligible' | 'corrected' | 'deleted' | 'held' | 'expired' | 'quarantined';
export interface ProvenanceRecord { id: string; tenantId: TenantId; scope: MemoryScope; purpose: string; classification: EvidenceClassification; legalBasis: string; retention: string; locations: readonly string[]; transformation: string; parents: readonly string[]; digest: string; }
export interface ProvenanceInput extends Omit<ProvenanceRecord, 'tenantId' | 'scope' | 'parents'> { tenantId: string; scope: MemoryScopeInput; parents?: readonly string[]; }

function scope(scope: MemoryScopeInput): MemoryScope {
  if (scope.kind === 'platform') { if (scope.tenantId !== undefined) fail('INVALID'); return { kind: 'platform' }; }
  const scopedTenant = tenantId(scope.tenantId);
  if (scope.kind === 'tenant') return { kind: 'tenant', tenantId: scopedTenant };
  const generation = scope.generation;
  if (scope.kind === 'case' && scope.caseId && Number.isSafeInteger(generation) && generation !== undefined && generation > 0) return { kind: 'case', tenantId: scopedTenant, caseId: scope.caseId, generation };
  if (scope.kind === 'activation' && scope.activationId) return { kind: 'activation', tenantId: scopedTenant, activationId: scope.activationId };
  if (scope.kind === 'agent' && scope.activationId && scope.agentId) return { kind: 'agent', tenantId: scopedTenant, activationId: scope.activationId, agentId: scope.agentId };
  return fail('INVALID');
}
const scopeKey = (value: MemoryScope): string => canonicalJson(value);
const sameScope = (left: MemoryScope, right: MemoryScope): boolean => scopeKey(left) === scopeKey(right);
const validDigest = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);

/** Immutable records plus append-only eligibility statuses. */
export class ProvenanceGraph {
  readonly #records = new Map<string, ProvenanceRecord>(); readonly #statuses = new Map<string, ProvenanceStatus>(); #epoch = 1;
  get epoch(): number { return this.#epoch; }
  add(input: ProvenanceInput): ProvenanceRecord {
    const record: ProvenanceRecord = { ...input, tenantId: tenantId(input.tenantId), scope: scope(input.scope), parents: [...(input.parents ?? [])], locations: [...input.locations] };
    if (!record.id || !record.purpose || !record.legalBasis || !record.retention || !record.transformation || !record.locations.length || !validDigest(record.digest) || this.#records.has(record.id) || new Set(record.parents).size !== record.parents.length) fail(this.#records.has(record.id) ? 'CONFLICT' : 'INVALID');
    for (const parentId of record.parents) { const parent = this.#records.get(parentId) ?? fail('NOT_FOUND'); if (parent.tenantId !== record.tenantId || parentId === record.id) fail('DENIED'); }
    const immutable = Object.freeze({ ...record, locations: Object.freeze([...record.locations]), parents: Object.freeze([...record.parents]) }); this.#records.set(record.id, immutable); this.#statuses.set(record.id, 'eligible'); this.#epoch += 1; return immutable;
  }
  record(id: string): ProvenanceRecord { return this.#records.get(id) ?? fail('NOT_FOUND'); }
  status(id: string, next: Exclude<ProvenanceStatus, 'eligible'>): void { this.record(id); this.#statuses.set(id, next); this.#epoch += 1; }
  currentStatus(id: string): ProvenanceStatus { this.record(id); return this.#statuses.get(id) ?? fail('NOT_FOUND'); }
  descendants(id: string): readonly string[] { this.record(id); const found = [...this.#records.values()].filter((record) => record.parents.includes(id)).flatMap((record) => [record.id, ...this.descendants(record.id)]); return Object.freeze([...new Set(found)].sort()); }
  release(id: string): void { const current = this.currentStatus(id); if (current !== 'held' && current !== 'quarantined') fail('DENIED'); this.#statuses.set(id, 'eligible'); this.#epoch += 1; }
  eligible(id: string): boolean { const state = this.#statuses.get(id) ?? fail('NOT_FOUND'); return state === 'eligible' && this.record(id).parents.every((parent) => this.eligible(parent)); }
  lineage(id: string): readonly ProvenanceRecord[] { const record = this.record(id); return [...record.parents.flatMap((parent) => this.lineage(parent)), record]; }
}

export interface MemoryWrite { id: string; tenantId: string; scope: MemoryScopeInput; purpose: string; provenanceId: string; classification: EvidenceClassification; content: string; authorityCurrent: boolean; consentCurrent: boolean; policyCurrent: boolean; retentionCurrent: boolean; }
interface StoredMemory extends Omit<MemoryWrite, 'tenantId' | 'scope'> { tenantId: TenantId; scope: MemoryScope; }
export interface MemoryQuery { tenantId: string; scopes: readonly MemoryScopeInput[]; purpose: string; authorityCurrent: boolean; maxItems: number; maxTokens: number; }
export interface MemoryResultItem { id: string; provenance: { sourceId: string; sourceDigest: string; chain: readonly string[]; scope: MemoryScope; tenantId: TenantId; classification: EvidenceClassification; status: ProvenanceStatus }; content: string; score: number; truncated: boolean; }
export interface MemoryResult { adapter: string; quality: 'full' | 'reduced'; items: readonly MemoryResultItem[]; status: 'success' | 'empty'; }
export interface MemoryAdapter { readonly name: string; unavailable: boolean; write(input: MemoryWrite): void; query(input: MemoryQuery): Promise<MemoryResult>; }

export class InMemoryMemoryStore implements MemoryAdapter {
  readonly name: string = 'in-memory'; readonly #records = new Map<string, StoredMemory>(); readonly #cache = new Map<string, MemoryResult>(); public unavailable = false;
  constructor(protected readonly graph: ProvenanceGraph, private readonly now: () => string = () => new Date().toISOString()) {}
  write(input: MemoryWrite): void {
    const tenant = tenantId(input.tenantId); const recordScope = scope(input.scope); const provenance = this.graph.record(input.provenanceId);
    if (!input.id || !input.purpose || !input.content || this.#records.has(input.id)) fail(this.#records.has(input.id) ? 'CONFLICT' : 'INVALID');
    if (!input.authorityCurrent || !input.consentCurrent || !input.policyCurrent || !input.retentionCurrent || provenance.tenantId !== tenant || !sameScope(provenance.scope, recordScope) || provenance.purpose !== input.purpose || provenance.classification !== input.classification || !this.graph.eligible(provenance.id)) fail('DENIED');
    this.#records.set(input.id, Object.freeze({ ...input, tenantId: tenant, scope: recordScope })); this.#cache.clear();
  }
  query(input: MemoryQuery): Promise<MemoryResult> {
    if (this.unavailable) fail('UNAVAILABLE'); if (!input.authorityCurrent || !input.purpose || !Number.isSafeInteger(input.maxItems) || !Number.isSafeInteger(input.maxTokens) || input.maxItems < 1 || input.maxTokens < 1) fail('DENIED');
    const tenant = tenantId(input.tenantId); const allowed = input.scopes.map(scope); if (!allowed.length) fail('DENIED'); const cacheKey = [String(this.graph.epoch), canonicalJson({ ...input, tenantId: String(tenant), scopes: allowed })].join(':'); const cached = this.#cache.get(cacheKey); if (cached !== undefined) return Promise.resolve(copy(cached));
    const eligible = [...this.#records.values()].filter((record) => record.tenantId === tenant && record.purpose === input.purpose && allowed.some((candidate) => sameScope(candidate, record.scope)) && this.graph.eligible(record.provenanceId));
    let budget = input.maxTokens;
    const items: MemoryResultItem[] = eligible.sort((left, right) => left.id.localeCompare(right.id)).flatMap<MemoryResultItem>((record, index) => {
      if (index >= input.maxItems || budget < 1) return [];
      const tokens = record.content.split(/\s+/u).length; const available = budget; const truncated = tokens > available; budget -= Math.min(tokens, available); const source = this.graph.lineage(record.provenanceId)[0] ?? fail('INVALID');
      const status: ProvenanceStatus = this.graph.eligible(record.provenanceId) ? 'eligible' : 'corrected'; return [{ id: record.id, provenance: { sourceId: source.id, sourceDigest: source.digest, chain: this.graph.lineage(record.provenanceId).map((item) => item.id), scope: record.scope, tenantId: record.tenantId, classification: record.classification, status }, content: truncated ? record.content.split(/\s+/u).slice(0, available).join(' ') : record.content, score: eligible.length - index, truncated }];
    });
    const result: MemoryResult = Object.freeze({ adapter: this.name, quality: 'full', items: Object.freeze(items), status: items.length ? 'success' : 'empty' }); this.#cache.set(cacheKey, result); void this.now(); return Promise.resolve(copy(result));
  }
}

export class RelationalMemoryStore extends InMemoryMemoryStore { override readonly name = 'relational'; }

/** Fallback only changes an unavailable adapter; authorization and query scope remain fixed. */
export async function retrieveMemory(input: MemoryQuery, adapters: readonly MemoryAdapter[]): Promise<MemoryResult> {
  if (!adapters.length) fail('UNAVAILABLE'); let unavailable = false;
  for (const adapter of adapters) { try { const result = await adapter.query(input); return { ...result, quality: unavailable ? 'reduced' : 'full' }; } catch (error) { if (!(error instanceof MemoryError) || error.code !== 'UNAVAILABLE') throw error; unavailable = true; } }
  return fail('UNAVAILABLE');
}

export { GovernedMemoryLifecycle, ValidatedExperienceRegistry, type ExperienceStatus, type LegalHold, type LifecycleDisposition, type LifecycleKind, type LifecycleManifestItem, type LifecycleReport, type ValidatedExperience } from './lifecycle.js';
export { EvaluationLedger, GateCalculator, ImprovementOrchestrator, type CandidateState, type EvaluationKind, type GateDecision, type GateManifest, type LedgerAggregate, type LedgerComparison, type LedgerInput, type LedgerRecord, type OrchestratorCandidate } from './evaluation.js';
