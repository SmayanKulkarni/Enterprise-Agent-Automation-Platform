import sql from 'mssql';
import { canonicalJson } from '../../contracts/src/index.js';
import type { GroupContext } from '../../identity/src/index.js';
import { sqlPool } from '../../identity/src/sql-pool.js';
import { mapError } from '../../workflow/src/sql.js';

const PROCEDURES = { 'add-tenant': 'governance.add_tenant', 'remove-tenant': 'governance.remove_tenant' } as const;
export type GroupTenantCommand = keyof typeof PROCEDURES;
export interface GovernanceWrite { receipt: Record<string, unknown>; replayed: boolean; }

export class AzureSqlGovernanceStore {
  constructor(private readonly connectionString: string) { if (!connectionString.trim()) throw new Error('Missing AZURE_SQL_CONNECTION_STRING.'); }

  createGroup(userId: string, args: { name: string; tenantIds: readonly string[]; billingTenantId: string | null }, key: string, requestDigest: string, receipt: Record<string, unknown>): Promise<GovernanceWrite> {
    return this.execute('governance.create_group', (request) => request.input('user_id', sql.UniqueIdentifier, userId).input('name', sql.NVarChar(128), args.name).input('tenant_ids', sql.NVarChar(sql.MAX), JSON.stringify(args.tenantIds)).input('billing_tenant_id', sql.UniqueIdentifier, args.billingTenantId), key, requestDigest, receipt);
  }

  command(name: GroupTenantCommand, context: GroupContext, expectedEpoch: number, args: Record<string, unknown>, key: string, requestDigest: string, receipt: Record<string, unknown>): Promise<GovernanceWrite> {
    return this.execute(PROCEDURES[name], (request) => request.input('group_id', sql.UniqueIdentifier, context.groupId).input('user_id', sql.UniqueIdentifier, context.userId).input('group_epoch', sql.BigInt, expectedEpoch).input('admin_epoch', sql.BigInt, context.adminEpoch).input('tenant_id', sql.UniqueIdentifier, String(args['tenantId'])), key, requestDigest, receipt);
  }

  private async execute(procedure: string, bind: (request: sql.Request) => sql.Request, key: string, requestDigest: string, receipt: Record<string, unknown>): Promise<GovernanceWrite> {
    let result: sql.IProcedureResult<unknown>;
    try { result = await bind((await sqlPool(this.connectionString)).request()).input('idempotency_key', sql.UniqueIdentifier, key).input('request_digest', sql.Char(64), requestDigest).input('receipt_json', sql.NVarChar(sql.MAX), canonicalJson(receipt)).execute(procedure); } catch (error) { return mapError(error); }
    const row = result.recordset[0] as { receipt_json?: string; replayed?: boolean } | undefined;
    if (row === undefined || typeof row.receipt_json !== 'string') throw Object.assign(new Error('INVALID'), { code: 'INVALID' });
    return { receipt: JSON.parse(row.receipt_json) as Record<string, unknown>, replayed: Boolean(row.replayed) };
  }
}
