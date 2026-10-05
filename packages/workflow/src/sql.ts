import sql from 'mssql';
import { canonicalJson } from '../../contracts/src/index.js';
import type { ExecutionContext } from '../../identity/src/index.js';
import { sqlPool } from '../../identity/src/sql-pool.js';
import type { WorkflowDefinition } from './graph.js';
import type { EffectData } from './runtime.js';
import type { WorkflowRun } from './service.js';

export type RecordKind = 'installation' | 'run' | 'effect' | 'summary' | 'grant' | 'circuit' | 'webhook-credential' | 'webhook-dispatch' | 'memory-import' | 'memory-item' | 'memory-lifecycle' | 'memory-retrieval' | 'memory-consolidation' | 'openrouter-connection' | 'model-settings' | 'mcp-credential';
export interface WorkflowRecord<T = Record<string, unknown>> { id: string; kind: RecordKind; version: number; state: string; data: T; }
export interface RunHistoryCursor { createdAt: string; id: string; }
export interface RunHistoryRecord<T = Record<string, unknown>> extends WorkflowRecord<T> { createdAt: string; }
export interface RunHistoryPage { runs: readonly RunHistoryRecord<unknown>[]; effects: readonly WorkflowRecord<unknown>[]; retrievals: readonly WorkflowRecord<unknown>[]; hasMore: boolean; }
export interface PublishedDefinition { id: string; draftId: string; draftRevision: number; digest: string; definition: WorkflowDefinition; }
export interface PendingWebhookDispatch { tenantId: string; runId: string; }
export interface ReconciliationWrite { run: WorkflowRecord<WorkflowRun>; effect: WorkflowRecord<EffectData>; runData: WorkflowRun; effectData: EffectData; receipt: Record<string, unknown>; effectReceipt: Record<string, unknown>; key: string; effectKey: string; requestDigest: string; }
export interface WorkflowStore {
  assertProfile(context: ExecutionContext, profile: 'editor' | 'admin' | 'operator'): Promise<void>;
  read<T>(context: ExecutionContext, kind: RecordKind, id: string): Promise<WorkflowRecord<T> | undefined>;
  list<T>(context: ExecutionContext, kind: RecordKind): Promise<readonly WorkflowRecord<T>[]>;
  runHistory(context: ExecutionContext, pageSize: number, cursor?: RunHistoryCursor, id?: string): Promise<RunHistoryPage>;
  write(context: ExecutionContext, profile: 'editor' | 'admin' | 'operator', kind: RecordKind, id: string, expectedVersion: number, state: string, data: unknown, key: string, requestDigest: string, receipt: Record<string, unknown>): Promise<{ receipt: Record<string, unknown>; replayed: boolean }>;
  reconcile(context: ExecutionContext, input: ReconciliationWrite): Promise<Record<string, unknown>>;
  workerRead<T>(tenantId: string, kind: RecordKind, id: string): Promise<WorkflowRecord<T> | undefined>;
  workerList<T>(tenantId: string, kind: RecordKind): Promise<readonly WorkflowRecord<T>[]>;
  workerWrite<T>(tenantId: string, kind: RecordKind, id: string, expectedVersion: number, state: string, data: T): Promise<WorkflowRecord<T>>;
  admitWebhookRun?(tenantId: string, runId: string, definitionId: string, inputDigest: string, run: unknown): Promise<boolean>;
  pendingWebhookDispatches?(): Promise<readonly PendingWebhookDispatch[]>;
  workerDefinition(tenantId: string, id: string): Promise<PublishedDefinition | undefined>;
  definitions(context: ExecutionContext, id?: string): Promise<readonly PublishedDefinition[]>;
  publish(context: ExecutionContext, definition: WorkflowDefinition, draftId: string, draftRevision: number, draftDigest: string, reviewDigest: string): Promise<void>;
}

const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
export const mapError = (error: unknown): never => {
  const number = error !== null && typeof error === 'object' && 'number' in error ? error.number : undefined;
  if (number === 50001) fail('DENIED');
  if (number === 50002) fail('INVALID');
  if (number === 50003) fail('STALE');
  if (number === 50004) fail('CONFLICT');
  throw error;
};
const rowRecord = <T>(row: Record<string, unknown>): WorkflowRecord<T> => ({ id: String(row['id']), kind: String(row['kind']) as RecordKind, version: Number(row['version']), state: String(row['state']), data: JSON.parse(String(row['data_json'])) as T });
const runHistoryRecord = (row: Record<string, unknown>): RunHistoryRecord => {
  if (typeof row['cursor_created_at'] !== 'string') return fail('INVALID');
  return { ...rowRecord(row), createdAt: row['cursor_created_at'] };
};

export class AzureSqlWorkflowStore implements WorkflowStore {
  constructor(private readonly connectionString: string) { if (!connectionString.trim()) fail('INVALID'); }
  private context(context: ExecutionContext): (request: sql.Request) => sql.Request { return (request) => request.input('tenant_id', sql.UniqueIdentifier, String(context.tenantId)).input('user_id', sql.UniqueIdentifier, context.userId).input('tenant_epoch', sql.BigInt, context.tenantEpoch).input('membership_epoch', sql.BigInt, context.membershipEpoch); }
  private async call(procedure: string, bind: (request: sql.Request) => sql.Request): Promise<sql.IProcedureResult<unknown>> {
    try { return await bind((await sqlPool(this.connectionString)).request()).execute(procedure); } catch (error) { return mapError(error); }
  }
  async assertProfile(context: ExecutionContext, profile: 'editor' | 'admin' | 'operator'): Promise<void> {
    await this.call('workflow.check_profile', (request) => this.context(context)(request).input('profile', sql.NVarChar(32), profile));
  }
  async read<T>(context: ExecutionContext, kind: RecordKind, id: string): Promise<WorkflowRecord<T> | undefined> {
    const result = await this.call('workflow.read_record', (request) => this.context(context)(request).input('kind', sql.NVarChar(24), kind).input('id', sql.UniqueIdentifier, id));
    const row = result.recordset[0] as Record<string, unknown> | undefined; return row && rowRecord<T>(row);
  }
  async list<T>(context: ExecutionContext, kind: RecordKind): Promise<readonly WorkflowRecord<T>[]> {
    const result = await this.call('workflow.read_record', (request) => this.context(context)(request).input('kind', sql.NVarChar(24), kind).input('id', sql.UniqueIdentifier, null));
    return (result.recordset as Record<string, unknown>[]).map(rowRecord<T>);
  }
  async runHistory(context: ExecutionContext, pageSize: number, cursor?: RunHistoryCursor, id?: string): Promise<RunHistoryPage> {
    const result = await this.call('workflow.read_run_history', (request) => this.context(context)(request)
      .input('page_size', sql.Int, pageSize)
      .input('before_created_at', sql.NVarChar(33), cursor?.createdAt ?? null)
      .input('before_id', sql.UniqueIdentifier, cursor?.id ?? null)
      .input('run_id', sql.UniqueIdentifier, id ?? null));
    const recordsets = result.recordsets as readonly Record<string, unknown>[][];
    const page = recordsets[0] ?? []; const effects = recordsets[1] ?? []; const retrievals = recordsets[2] ?? []; const continuation = recordsets[3]?.[0];
    return { runs: page.map(runHistoryRecord), effects: effects.map(rowRecord), retrievals: retrievals.map(rowRecord), hasMore: continuation?.['has_more'] === true || continuation?.['has_more'] === 1 };
  }
  async write(context: ExecutionContext, profile: 'editor' | 'admin' | 'operator', kind: RecordKind, id: string, expectedVersion: number, state: string, data: unknown, key: string, requestDigest: string, receipt: Record<string, unknown>): Promise<{ receipt: Record<string, unknown>; replayed: boolean }> {
    const result = await this.call('workflow.write_record', (request) => this.context(context)(request).input('profile', sql.NVarChar(32), profile).input('kind', sql.NVarChar(24), kind).input('id', sql.UniqueIdentifier, id).input('expected_version', sql.BigInt, expectedVersion).input('state', sql.NVarChar(32), state).input('data_json', sql.NVarChar(sql.MAX), canonicalJson(data)).input('idempotency_key', sql.UniqueIdentifier, key).input('request_digest', sql.Char(64), requestDigest).input('receipt_json', sql.NVarChar(sql.MAX), canonicalJson(receipt)));
    const row = result.recordset[0] as { receipt_json?: string; replayed?: boolean } | undefined;
    if (row === undefined || typeof row.receipt_json !== 'string') throw Object.assign(new Error('INVALID'), { code: 'INVALID' });
    return { receipt: JSON.parse(row.receipt_json) as Record<string, unknown>, replayed: Boolean(row.replayed) };
  }
  async reconcile(context: ExecutionContext, input: ReconciliationWrite): Promise<Record<string, unknown>> {
    const transaction = new sql.Transaction(await sqlPool(this.connectionString));
    await transaction.begin();
    try {
      let receipt = input.receipt;
      for (const item of [
        { record: input.effect, state: input.effectData.state, data: input.effectData, key: input.effectKey, receipt: input.effectReceipt },
        { record: input.run, state: input.runData.status, data: input.runData, key: input.key, receipt: input.receipt },
      ]) {
        const result = await this.context(context)(transaction.request())
          .input('profile', sql.NVarChar(32), 'admin')
          .input('kind', sql.NVarChar(24), item.record.kind)
          .input('id', sql.UniqueIdentifier, item.record.id)
          .input('expected_version', sql.BigInt, item.record.version)
          .input('state', sql.NVarChar(32), item.state)
          .input('data_json', sql.NVarChar(sql.MAX), canonicalJson(item.data))
          .input('idempotency_key', sql.UniqueIdentifier, item.key)
          .input('request_digest', sql.Char(64), input.requestDigest)
          .input('receipt_json', sql.NVarChar(sql.MAX), canonicalJson(item.receipt))
          .execute('workflow.write_record');
        if (item.record.kind === 'run') {
          const row = result.recordset[0] as { receipt_json?: string } | undefined;
          if (typeof row?.receipt_json !== 'string') return fail('INVALID');
          receipt = JSON.parse(row.receipt_json) as Record<string, unknown>;
        }
      }
      await transaction.commit();
      return receipt;
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      return mapError(error);
    }
  }
  async workerRead<T>(tenantId: string, kind: RecordKind, id: string): Promise<WorkflowRecord<T> | undefined> {
    const result = await this.call('workflow.worker_read_record', (request) => request.input('tenant_id', sql.UniqueIdentifier, tenantId).input('kind', sql.NVarChar(24), kind).input('id', sql.UniqueIdentifier, id));
    const row = result.recordset[0] as Record<string, unknown> | undefined; return row && rowRecord<T>(row);
  }
  async workerList<T>(tenantId: string, kind: RecordKind): Promise<readonly WorkflowRecord<T>[]> {
    const result = await this.call('workflow.worker_list_records', (request) => request.input('tenant_id', sql.UniqueIdentifier, tenantId).input('kind', sql.NVarChar(24), kind));
    return (result.recordset as Record<string, unknown>[]).map(rowRecord<T>);
  }
  async workerWrite<T>(tenantId: string, kind: RecordKind, id: string, expectedVersion: number, state: string, data: T): Promise<WorkflowRecord<T>> {
    const result = await this.call('workflow.worker_write_record', (request) => request.input('tenant_id', sql.UniqueIdentifier, tenantId).input('kind', sql.NVarChar(24), kind).input('id', sql.UniqueIdentifier, id).input('expected_version', sql.BigInt, expectedVersion).input('state', sql.NVarChar(32), state).input('data_json', sql.NVarChar(sql.MAX), canonicalJson(data)));
    const row = result.recordset[0] as Record<string, unknown> | undefined; return row ? rowRecord<T>(row) : fail('INVALID');
  }
  async admitWebhookRun(tenantId: string, runId: string, definitionId: string, inputDigest: string, run: unknown): Promise<boolean> {
    const result = await this.call('workflow.admit_webhook_run', (request) => request.input('tenant_id', sql.UniqueIdentifier, tenantId).input('run_id', sql.UniqueIdentifier, runId).input('definition_id', sql.UniqueIdentifier, definitionId).input('input_digest', sql.Char(64), inputDigest).input('run_json', sql.NVarChar(sql.MAX), canonicalJson(run)));
    return Boolean((result.recordset[0] as { admitted?: boolean } | undefined)?.admitted);
  }
  async pendingWebhookDispatches(): Promise<readonly PendingWebhookDispatch[]> {
    const result = await this.call('workflow.worker_pending_webhook_dispatches', (request) => request);
    return (result.recordset as Record<string, unknown>[]).map((row) => ({ tenantId: String(row['tenant_id']), runId: String(row['id']) }));
  }
  async definitions(context: ExecutionContext, id?: string): Promise<readonly PublishedDefinition[]> {
    const result = await this.call('workflow.read_definitions', (request) => this.context(context)(request).input('id', sql.UniqueIdentifier, id ?? null));
    return (result.recordset as Record<string, unknown>[]).map((row) => ({ id: String(row['id']), draftId: String(row['draft_id']), draftRevision: Number(row['draft_revision']), digest: String(row['digest']), definition: JSON.parse(String(row['definition_json'])) as WorkflowDefinition }));
  }
  async workerDefinition(tenantId: string, id: string): Promise<PublishedDefinition | undefined> {
    const result = await this.call('workflow.worker_read_definition', (request) => request.input('tenant_id', sql.UniqueIdentifier, tenantId).input('id', sql.UniqueIdentifier, id));
    const row = result.recordset[0] as Record<string, unknown> | undefined;
    return row && { id: String(row['id']), draftId: String(row['draft_id']), draftRevision: Number(row['draft_revision']), digest: String(row['digest']), definition: JSON.parse(String(row['definition_json'])) as WorkflowDefinition };
  }
  async publish(context: ExecutionContext, definition: WorkflowDefinition, draftId: string, draftRevision: number, draftDigest: string, reviewDigest: string): Promise<void> {
    await this.call('workflow.publish_definition', (request) => this.context(context)(request).input('id', sql.UniqueIdentifier, definition.id).input('draft_id', sql.UniqueIdentifier, draftId).input('revision', sql.BigInt, draftRevision).input('draft_digest', sql.Char(64), draftDigest).input('digest', sql.Char(64), definition.digest).input('definition_json', sql.NVarChar(sql.MAX), canonicalJson(definition)).input('review_digest', sql.Char(64), reviewDigest));
  }
}
