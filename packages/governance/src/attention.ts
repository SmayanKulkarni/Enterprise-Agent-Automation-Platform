import { toCount, type Numeric } from './reads.js';

export interface PendingApprovalRow { tenantId: string; workspace: string; runId: string; runVersion: Numeric; definitionRevision: Numeric; workflowName: string | null; runLabel: string | null; waitingJson: string | null; waitingKind: string | null }
export interface HealthRows {
  connectors: { tenantId: string; workspace: string; state: string; installations: Numeric }[];
  circuits: { tenantId: string; workspace: string; key: string | null; state: string; since: Date }[];
  reconciliation: { tenantId: string; workspace: string; runId: string; since: Date }[];
}
export interface Approval {
  tenantId: string; workspace: string; runId: string; runVersion: number; workflowName: string; runLabel?: string; revision: number; nodeId: string; kind: 'step' | 'tool';
  capability: string; installationId: string; target: string; arguments: { name: string; type: string }[]; facts: { name: string; value: string }[]; argumentsDigest: string; requestedAt?: string; expiresAt: string; bindingDigest: string;
}
export interface Health {
  connectors: { tenantId: string; workspace: string; healthy: number; offline: number; revoked: number }[];
  circuits: { tenantId: string; workspace: string; key: string; state: 'open' | 'probe'; since: string }[];
  reconciliation: { tenantId: string; workspace: string; runId: string; since: string }[];
}

export const APPROVAL_LIMIT = 200;
export const HEALTH_LIMIT = 100;
const DIGEST = /^[0-9a-f]{64}$/u;
const CIRCUIT_KEY = /^(model|connector):[A-Za-z0-9._-]{1,64}$/u;
const ARGUMENT_LIMIT = 100;
const NAME_LIMIT = 128;
const LABEL_LIMIT = 120;
const FACT_LIMIT = 4000;
const FACT_COUNT = 9;
const TEXT_LIMIT = 256;
const UNTITLED = 'Untitled workflow';

const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown, limit: number): string | undefined => typeof value === 'string' && value.length > 0 ? value.slice(0, limit) : undefined;
const digest = (value: unknown): string | undefined => typeof value === 'string' && DIGEST.test(value) ? value : undefined;
const instant = (value: unknown): string | undefined => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value)).toISOString() : undefined;
const safeCount = (value: Numeric): number | undefined => { try { return value === null ? undefined : toCount(value); } catch { return undefined; } };
const parse = (value: string | null): unknown => { try { return value === null ? undefined : JSON.parse(value); } catch { return undefined; } };
const since = (value: Date): string | undefined => Number.isNaN(value.getTime()) ? undefined : value.toISOString();

const argumentsOf = (value: unknown): { name: string; type: string }[] => (Array.isArray(value) ? value.slice(0, ARGUMENT_LIMIT) : []).flatMap((entry: unknown) => {
  const name = text(record(entry)?.['name'], NAME_LIMIT); const type = text(record(entry)?.['type'], NAME_LIMIT);
  return name === undefined || type === undefined ? [] : [{ name, type }];
});

const factsOf = (value: unknown): { name: string; value: string }[] => (Array.isArray(value) ? value.slice(0, FACT_COUNT) : []).flatMap((entry: unknown) => {
  const name = text(record(entry)?.['name'], NAME_LIMIT); const fact = text(record(entry)?.['value'], FACT_LIMIT);
  return name === undefined || fact === undefined ? [] : [{ name, value: fact }];
});

export function projectApproval(row: PendingApprovalRow): Approval | undefined {
  const waiting = record(parse(row.waitingJson)); const review = record(waiting?.['review']);
  const runVersion = safeCount(row.runVersion); const revision = safeCount(row.definitionRevision);
  const nodeId = text(waiting?.['nodeId'], NAME_LIMIT); const bindingDigest = digest(waiting?.['bindingDigest']); const expiresAt = instant(waiting?.['expiresAt']);
  const capability = text(review?.['capability'], TEXT_LIMIT); const installationId = text(review?.['installationId'], NAME_LIMIT); const target = text(review?.['target'], TEXT_LIMIT); const argumentsDigest = digest(review?.['argumentsDigest']);
  if (runVersion === undefined || revision === undefined || nodeId === undefined || bindingDigest === undefined || expiresAt === undefined || capability === undefined || installationId === undefined || target === undefined || argumentsDigest === undefined) return undefined;
  const requestedAt = instant(waiting?.['requestedAt']); const runLabel = row.runLabel?.trim().slice(0, LABEL_LIMIT);
  return {
    tenantId: row.tenantId, workspace: row.workspace, runId: row.runId, runVersion, workflowName: row.workflowName?.trim().slice(0, NAME_LIMIT) || UNTITLED, ...(runLabel ? { runLabel } : {}), revision, nodeId,
    kind: row.waitingKind === 'agent' ? 'tool' : 'step', capability, installationId, target, arguments: argumentsOf(review?.['arguments']), facts: factsOf(review?.['facts']), argumentsDigest,
    ...(requestedAt === undefined ? {} : { requestedAt }), expiresAt, bindingDigest,
  };
}

export function buildApprovals(rows: readonly PendingApprovalRow[]): { approvals: Approval[]; count: number; completeness: 'full' | 'partial' } {
  const approvals = rows.flatMap((row) => projectApproval(row) ?? []);
  return { approvals, count: approvals.length, completeness: approvals.length < rows.length || rows.length >= APPROVAL_LIMIT ? 'partial' : 'full' };
}

export function buildHealth(rows: HealthRows): Health & { completeness: 'full' | 'partial' } {
  const byTenant = new Map<string, Health['connectors'][number]>();
  for (const row of rows.connectors) {
    if (row.state !== 'healthy' && row.state !== 'offline' && row.state !== 'revoked') continue;
    const entry = byTenant.get(row.tenantId) ?? { tenantId: row.tenantId, workspace: row.workspace, healthy: 0, offline: 0, revoked: 0 };
    byTenant.set(row.tenantId, { ...entry, [row.state]: entry[row.state] + toCount(row.installations) });
  }
  const circuits = rows.circuits.flatMap((row): Health['circuits'] => {
    const at = since(row.since); const state = row.state;
    if (at === undefined || state !== 'open' && state !== 'probe') return [];
    return [{ tenantId: row.tenantId, workspace: row.workspace, key: row.key !== null && CIRCUIT_KEY.test(row.key) ? row.key : 'unknown', state, since: at }];
  });
  const reconciliation = rows.reconciliation.flatMap((row) => { const at = since(row.since); return at === undefined ? [] : [{ tenantId: row.tenantId, workspace: row.workspace, runId: row.runId, since: at }]; });
  const capped = rows.circuits.length >= HEALTH_LIMIT || rows.reconciliation.length >= HEALTH_LIMIT || circuits.length < rows.circuits.length || reconciliation.length < rows.reconciliation.length;
  return { connectors: [...byTenant.values()], circuits, reconciliation, completeness: capped ? 'partial' : 'full' };
}
