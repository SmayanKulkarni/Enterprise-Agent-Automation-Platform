import sql from 'mssql';
import { canonicalJson } from '../../contracts/src/index.js';
import type { GroupContext } from '../../identity/src/index.js';
import { sqlPool } from '../../identity/src/sql-pool.js';
import { mapError } from '../../workflow/src/sql.js';

const COMMANDS = {
  'add-tenant': { procedure: 'governance.add_tenant', parameter: 'tenant_id', argument: 'tenantId' },
  'remove-tenant': { procedure: 'governance.remove_tenant', parameter: 'tenant_id', argument: 'tenantId' },
  'add-admin': { procedure: 'governance.add_admin', parameter: 'candidate_user_id', argument: 'userId' },
  'remove-admin': { procedure: 'governance.remove_admin', parameter: 'target_user_id', argument: 'userId' },
  'set-billing-tenant': { procedure: 'governance.set_billing_tenant', parameter: 'tenant_id', argument: 'tenantId' },
} as const;
export type GroupCommandName = keyof typeof COMMANDS;
export interface GovernanceWrite { receipt: Record<string, unknown>; replayed: boolean; }
export interface GroupMembers {
  workspaces: { tenantId: string; name: string; joinedAt: string; billing: boolean }[];
  admins: { userId: string; name: string }[];
  eligible: { userId: string; name: string }[];
}

const invalid = (): never => { throw Object.assign(new Error('INVALID'), { code: 'INVALID' }); };
const text = (value: unknown): string => typeof value === 'string' ? value : invalid();
const id = (value: unknown): string => text(value).toLowerCase();
const timestamp = (value: unknown): string => value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : invalid();
const rows = (recordset: unknown): Record<string, unknown>[] => Array.isArray(recordset) ? recordset as Record<string, unknown>[] : invalid();
const person = (row: Record<string, unknown>): { userId: string; name: string } => ({ userId: id(row['user_id']), name: row['display_name'] === null ? '' : text(row['display_name']) });

export class AzureSqlGovernanceStore {
  constructor(private readonly connectionString: string) { if (!connectionString.trim()) throw new Error('Missing AZURE_SQL_CONNECTION_STRING.'); }

  createGroup(userId: string, args: { name: string; tenantIds: readonly string[]; billingTenantId: string | null }, key: string, requestDigest: string, receipt: Record<string, unknown>): Promise<GovernanceWrite> {
    return this.execute('governance.create_group', (request) => request.input('user_id', sql.UniqueIdentifier, userId).input('name', sql.NVarChar(128), args.name).input('tenant_ids', sql.NVarChar(sql.MAX), JSON.stringify(args.tenantIds)).input('billing_tenant_id', sql.UniqueIdentifier, args.billingTenantId), key, requestDigest, receipt);
  }

  command(name: GroupCommandName, context: GroupContext, expectedEpoch: number, args: Record<string, unknown>, key: string, requestDigest: string, receipt: Record<string, unknown>): Promise<GovernanceWrite> {
    const { procedure, parameter, argument } = COMMANDS[name];
    return this.execute(procedure, (request) => request.input('group_id', sql.UniqueIdentifier, context.groupId).input('user_id', sql.UniqueIdentifier, context.userId).input('group_epoch', sql.BigInt, expectedEpoch).input('admin_epoch', sql.BigInt, context.adminEpoch).input(parameter, sql.UniqueIdentifier, String(args[argument])), key, requestDigest, receipt);
  }

  async members(context: GroupContext): Promise<GroupMembers> {
    let result: sql.IProcedureResult<unknown>;
    try { result = await (await sqlPool(this.connectionString)).request().input('group_id', sql.UniqueIdentifier, context.groupId).input('user_id', sql.UniqueIdentifier, context.userId).input('group_epoch', sql.BigInt, context.groupEpoch).input('admin_epoch', sql.BigInt, context.adminEpoch).execute('governance.read_members'); } catch (error) { return mapError(error); }
    const [workspaces, admins, eligible] = result.recordsets as unknown[];
    return {
      workspaces: rows(workspaces).map((row) => ({ tenantId: id(row['tenant_id']), name: text(row['slug']), joinedAt: timestamp(row['joined_at']), billing: row['is_billing'] === true })),
      admins: rows(admins).map(person),
      eligible: rows(eligible).map(person),
    };
  }

  private async execute(procedure: string, bind: (request: sql.Request) => sql.Request, key: string, requestDigest: string, receipt: Record<string, unknown>): Promise<GovernanceWrite> {
    let result: sql.IProcedureResult<unknown>;
    try { result = await bind((await sqlPool(this.connectionString)).request()).input('idempotency_key', sql.UniqueIdentifier, key).input('request_digest', sql.Char(64), requestDigest).input('receipt_json', sql.NVarChar(sql.MAX), canonicalJson(receipt)).execute(procedure); } catch (error) { return mapError(error); }
    const row = result.recordset[0] as { receipt_json?: string; replayed?: boolean } | undefined;
    if (row === undefined || typeof row.receipt_json !== 'string') throw Object.assign(new Error('INVALID'), { code: 'INVALID' });
    return { receipt: JSON.parse(row.receipt_json) as Record<string, unknown>, replayed: Boolean(row.replayed) };
  }
}
