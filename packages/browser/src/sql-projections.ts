import sql from 'mssql';
import { IdentityError, type ExecutionContext } from '../../identity/src/index.js';
import type { BrowserProjection } from './index.js';

interface SnapshotRow {
  records_json: string;
  watermark: number;
  completeness: 'full' | 'partial';
  classification: 'ordinary' | 'restricted-operational' | 'fixture';
  redaction: 'none' | 'applied';
  published_at: Date;
  expires_at: Date;
}

class ProjectionUnavailableError extends Error {
  readonly code = 'PROJECTION_UNAVAILABLE';
  constructor() { super('Projection is unavailable.'); }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const forbidden = /(?:token|secret|password|credential|payload|api.?key|private.?key|authorization|connection.?string|cookie|bearer)/iu;
const safe = (value: unknown): boolean => {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return typeof value !== 'number' || Number.isFinite(value);
  if (Array.isArray(value)) return value.every(safe);
  return typeof value === 'object' && Object.entries(value as Record<string, unknown>).every(([key, child]) => !forbidden.test(key) && safe(child));
};

/** Turns one persisted snapshot into a browser-safe, Tenant-scoped read result. */
export function projectSnapshot(input: BrowserProjection, row: SnapshotRow | undefined, now = new Date()): Record<string, unknown> {
  const tenantId = String(input.context.tenantId);
  if (row === undefined) return { tenantId, collection: input.collection, records: [], completeness: 'not-ready', classification: 'restricted-operational', freshness: 'unknown', redaction: 'none' };
  const parsed: unknown = JSON.parse(row.records_json);
  if (!Array.isArray(parsed) || !parsed.every((record: unknown) => record !== null && typeof record === 'object' && !Array.isArray(record) && uuid.test(String((record as Record<string, unknown>)['id'])) && safe(record) && ((record as Record<string, unknown>)['tenantId'] === undefined || (record as Record<string, unknown>)['tenantId'] === tenantId))) throw new Error('UNSAFE_PROJECTION');
  const fresh = row.expires_at.getTime() > now.getTime();
  const freshness = fresh ? 'current' : 'stale';
  const records = (parsed as Record<string, unknown>[]).filter((record) => input.id === undefined || record['id'] === input.id).map((record) => ({ ...record, classification: row.classification, freshness, redaction: row.redaction }));
  return { tenantId, collection: input.collection, records, watermark: row.watermark, publishedAt: row.published_at.toISOString(), completeness: fresh ? row.completeness : 'partial', classification: row.classification, freshness, redaction: row.redaction };
}

/** SQL role can execute only the epoch-fenced Tenant read procedure. */
export class AzureSqlProjectionStore {
  constructor(private readonly connectionString: string) {}

  async read(input: BrowserProjection): Promise<Record<string, unknown>> {
    const context: ExecutionContext = input.context;
    let pool: sql.ConnectionPool | undefined;
    try {
      pool = await new sql.ConnectionPool(this.connectionString).connect();
      const result = await pool.request()
        .input('tenant_id', sql.UniqueIdentifier, String(context.tenantId))
        .input('user_id', sql.UniqueIdentifier, context.userId)
        .input('tenant_epoch', sql.BigInt, context.tenantEpoch)
        .input('membership_epoch', sql.BigInt, context.membershipEpoch)
        .input('collection', sql.NVarChar(40), input.collection)
        .execute('projection.read_snapshot');
      const row = result.recordset[0] as SnapshotRow | { records_json: null } | undefined;
      if (row === undefined) throw new IdentityError('DENIED');
      return projectSnapshot(input, row.records_json === null ? undefined : row);
    } catch (error) {
      if (error instanceof IdentityError) throw error;
      if (error !== null && typeof error === 'object' && 'number' in error && error.number === 50001) throw new IdentityError('DENIED');
      throw new ProjectionUnavailableError();
    } finally { await pool?.close(); }
  }
}
