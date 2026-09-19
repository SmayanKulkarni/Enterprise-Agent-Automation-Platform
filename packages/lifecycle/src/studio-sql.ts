import sql from 'mssql';
import { canonicalJson, digest } from '../../contracts/src/index.js';
import type { ExecutionContext } from '../../identity/src/index.js';
import type { StudioDraft } from './studio.js';

export type StudioState = 'draft' | 'candidate' | 'approved' | 'signed' | 'published' | 'rejected';
export interface StudioStoredDraft { id: string; tenantId: string; revision: number; state: StudioState; digest: string; author: string; draft: StudioDraft; createdAt: string; }
export interface StudioRunEvidence { id: string; revision: number; subjectDigest: string; kind: 'checks' | 'simulation' | 'evaluation'; status: 'passed' | 'failed' | 'blocked' | 'inconclusive'; report: Record<string, unknown>; }
export interface StudioReviewEvidence { id: string; revision: number; candidateDigest: string; decision: 'approved' | 'rejected' | 'signed' | 'published'; actorId: string; reason: string; evidenceIds: readonly string[]; }
export interface CommandReceipt { commandId: string; objectId: string; revision: number; state: StudioState; digest: string; evidenceIds: readonly string[]; }
export interface StudioStore {
  create(context: ExecutionContext, id: string, draft: StudioDraft): Promise<StudioStoredDraft>;
  get(context: ExecutionContext, id: string): Promise<StudioStoredDraft>;
  list(context: ExecutionContext): Promise<readonly StudioStoredDraft[]>;
  save(context: ExecutionContext, id: string, expectedRevision: number, draft: StudioDraft, idempotencyKey: string): Promise<StudioStoredDraft>;
  appendRun(context: ExecutionContext, id: string, evidence: StudioRunEvidence): Promise<void>;
  appendReview(context: ExecutionContext, id: string, evidence: StudioReviewEvidence): Promise<void>;
  rememberCommand(tenantId: string, key: string, requestDigest: string, receipt: CommandReceipt): Promise<CommandReceipt>;
}

export class StudioStoreError extends Error { constructor(public readonly code: 'CONFLICT' | 'DENIED' | 'INVALID' | 'NOT_FOUND' | 'STALE') { super('Studio storage request was not accepted.'); this.name = 'StudioStoreError'; } }
const fail = (code: StudioStoreError['code']): never => { throw new StudioStoreError(code); };
const asString = (value: unknown): string => typeof value === 'string' ? value : fail('INVALID');
const asInteger = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) ? value : fail('INVALID');
const asTimestamp = (value: unknown): string => value instanceof Date ? value.toISOString() : asString(value);
const parseJson = <Value>(value: unknown): Value => { try { return JSON.parse(asString(value)) as Value; } catch { return fail('INVALID'); } };
const receipt = (value: unknown): CommandReceipt => parseJson<CommandReceipt>(value);

/** Maps the narrow persisted Studio row to a typed immutable authoring revision. */
export function studioRecord(row: Record<string, unknown>): StudioStoredDraft {
  return Object.freeze({ id: asString(row['id']), tenantId: asString(row['tenant_id']), revision: asInteger(row['revision']), state: asString(row['state']) as StudioState, digest: asString(row['digest']), author: asString(row['author_id']), draft: parseJson<StudioDraft>(row['draft_json']), createdAt: asTimestamp(row['created_at']) });
}

/** Azure SQL is the durable Studio source of truth; no in-memory fallback is supplied. */
export class AzureSqlStudioStore implements StudioStore {
  constructor(private readonly connectionString: string) { if (!connectionString.trim()) throw new Error('Missing AZURE_SQL_CONNECTION_STRING.'); }

  async create(context: ExecutionContext, id: string, draft: StudioDraft): Promise<StudioStoredDraft> {
    const draftJson = canonicalJson(draft); const draftDigest = await digest(draft);
    return this.draftCall('studio.create_draft', context, (request) => request.input('draft_id', sql.UniqueIdentifier, id).input('draft_json', sql.NVarChar(sql.MAX), draftJson).input('digest', sql.Char(64), draftDigest));
  }
  async get(context: ExecutionContext, id: string): Promise<StudioStoredDraft> { return this.draftCall('studio.get_draft', context, (request) => request.input('draft_id', sql.UniqueIdentifier, id)); }
  async list(context: ExecutionContext): Promise<readonly StudioStoredDraft[]> {
    const result = await this.call('studio.list_drafts', this.context(context)); return Object.freeze((result.recordset as Record<string, unknown>[]).map(studioRecord));
  }
  async save(context: ExecutionContext, id: string, expectedRevision: number, draft: StudioDraft, idempotencyKey: string): Promise<StudioStoredDraft> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !idempotencyKey) fail('INVALID'); const draftJson = canonicalJson(draft); const draftDigest = await digest(draft);
    return this.draftCall('studio.save_draft', context, (request) => request.input('draft_id', sql.UniqueIdentifier, id).input('expected_revision', sql.BigInt, expectedRevision).input('draft_json', sql.NVarChar(sql.MAX), draftJson).input('digest', sql.Char(64), draftDigest).input('idempotency_key', sql.NVarChar(128), idempotencyKey).input('request_digest', sql.Char(64), draftDigest));
  }
  async appendRun(context: ExecutionContext, id: string, evidence: StudioRunEvidence): Promise<void> {
    await this.call('studio.append_run', (request) => this.context(context)(request).input('draft_id', sql.UniqueIdentifier, id).input('evidence_id', sql.UniqueIdentifier, evidence.id).input('revision', sql.BigInt, evidence.revision).input('subject_digest', sql.Char(64), evidence.subjectDigest).input('kind', sql.NVarChar(16), evidence.kind).input('status', sql.NVarChar(16), evidence.status).input('report_json', sql.NVarChar(sql.MAX), canonicalJson(evidence.report)));
  }
  async appendReview(context: ExecutionContext, id: string, evidence: StudioReviewEvidence): Promise<void> {
    await this.call('studio.append_review', (request) => this.context(context)(request).input('draft_id', sql.UniqueIdentifier, id).input('evidence_id', sql.UniqueIdentifier, evidence.id).input('revision', sql.BigInt, evidence.revision).input('candidate_digest', sql.Char(64), evidence.candidateDigest).input('decision', sql.NVarChar(16), evidence.decision).input('actor_id', sql.UniqueIdentifier, evidence.actorId).input('reason', sql.NVarChar(2000), evidence.reason).input('evidence_ids_json', sql.NVarChar(sql.MAX), canonicalJson(evidence.evidenceIds)));
  }
  async rememberCommand(tenantId: string, key: string, requestDigest: string, value: CommandReceipt): Promise<CommandReceipt> {
    const result = await this.call('studio.remember_command', (request) => request.input('tenant_id', sql.UniqueIdentifier, tenantId).input('idempotency_key', sql.NVarChar(128), key).input('request_digest', sql.Char(64), requestDigest).input('receipt_json', sql.NVarChar(sql.MAX), canonicalJson(value)));
    const row = result.recordset[0] as Record<string, unknown> | undefined; return row === undefined ? fail('INVALID') : receipt(row['receipt_json']);
  }

  private context(context: ExecutionContext): (request: sql.Request) => sql.Request { return (request) => request.input('tenant_id', sql.UniqueIdentifier, String(context.tenantId)).input('user_id', sql.UniqueIdentifier, context.userId).input('tenant_epoch', sql.BigInt, context.tenantEpoch).input('membership_epoch', sql.BigInt, context.membershipEpoch); }
  private async draftCall(procedure: string, context: ExecutionContext, bind: (request: sql.Request) => sql.Request): Promise<StudioStoredDraft> { const result = await this.call(procedure, (request) => bind(this.context(context)(request))); const row = result.recordset[0] as Record<string, unknown> | undefined; return row === undefined ? fail('NOT_FOUND') : studioRecord(row); }
  private async call(procedure: string, bind: (request: sql.Request) => sql.Request): Promise<sql.IProcedureResult<unknown>> {
    const pool = await new sql.ConnectionPool(this.connectionString).connect();
    try { return await bind(pool.request()).execute(procedure); } catch (error) { const number = error !== null && typeof error === 'object' && 'number' in error && typeof error.number === 'number' ? error.number : undefined; if (number === 50001) fail('DENIED'); if (number === 50002) fail('INVALID'); if (number === 50003) fail('STALE'); if (number === 50004) fail('CONFLICT'); throw error; } finally { await pool.close(); }
  }
}
