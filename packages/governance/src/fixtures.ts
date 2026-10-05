import { windowSpan } from './reads.js';
import type { HealthRows, PendingApprovalRow } from './attention.js';
import type { OverviewRows, SeriesRow, WindowRow, WorkflowRow } from './reads.js';
import type { RangeKey } from './catalog.js';

export interface FixtureGroupContext { userId: string; tenantIds: readonly string[] }

const FIXTURE_JOINED_AT = '2026-01-01T00:00:00.000Z';

export function fixtureMembers(context: FixtureGroupContext): { workspaces: { tenantId: string; name: string; joinedAt: string; billing: boolean }[]; admins: { userId: string; name: string }[]; eligible: { userId: string; name: string }[] } {
  return {
    workspaces: context.tenantIds.map((tenantId) => ({ tenantId: tenantId, name: `workspace-${tenantId.slice(0, 8)}`, joinedAt: FIXTURE_JOINED_AT, billing: false })),
    admins: [{ userId: context.userId, name: 'Local admin' }],
    eligible: [],
  };
}

const fixtureName = (tenantId: string): string => `workspace-${tenantId.slice(0, 8)}`;
const fixtureWindow = (window: WindowRow['window'], index: number, scale: number): WindowRow => {
  const runs = Math.floor((20 + 7 * index) * scale);
  return { window, runs, completed: runs - 3, failed: 2, unknownOutcome: 1, p95Ms: 1500 + 100 * index, tokens: runs * 1200, cost: runs * 0.0125, estimatedRuns: 0 };
};
const sumWindows = (rows: readonly WindowRow[], window: WindowRow['window']): WindowRow => {
  const own = rows.filter((row) => row.window === window);
  const add = (pick: (row: WindowRow) => number): number => own.reduce((sum, row) => sum + pick(row), 0);
  return { window, runs: add((row) => Number(row.runs)), completed: add((row) => Number(row.completed)), failed: add((row) => Number(row.failed)), unknownOutcome: add((row) => Number(row.unknownOutcome)), p95Ms: own.length === 0 ? null : Math.max(...own.map((row) => Number(row.p95Ms))), tokens: add((row) => Number(row.tokens)), cost: add((row) => Number(row.cost)), estimatedRuns: 0 };
};

export function fixtureOverview(tenantIds: readonly string[]): OverviewRows {
  const workspaces = tenantIds.flatMap((tenantId, index) => [fixtureWindow('current', index, 1), fixtureWindow('previous', index, 0.8)].map((row) => ({ ...row, tenantId, name: fixtureName(tenantId) })));
  return { workspaces, totals: [sumWindows(workspaces, 'current'), sumWindows(workspaces, 'previous')], pending: tenantIds.map((tenantId, index) => ({ tenantId, pendingApprovals: index % 3 })) };
}

export function fixtureSeries(tenantIds: readonly string[], range: RangeKey, from: number): SeriesRow[] {
  const { step, points } = windowSpan(range);
  return tenantIds.flatMap((tenantId, index) => Array.from({ length: points }, (_unused, bucket) => ({
    tenantId, name: fixtureName(tenantId), bucketStart: new Date(from + bucket * step), completed: (bucket + index) % 5 + 1, failed: bucket % 7 === 0 ? 1 : 0, unknownOutcome: 0, cost: ((bucket + index) % 5 + 1) * 0.0125, tokens: ((bucket + index) % 5 + 1) * 1200, estimatedRuns: 0,
  })));
}

export function fixtureWorkflows(tenantIds: readonly string[]): WorkflowRow[] {
  return tenantIds.map((tenantId, index) => {
    const runs = 20 + 7 * index;
    return { tenantId, workspace: fixtureName(tenantId), definitionId: `f0000000-0000-4000-8000-${String(index).padStart(12, '0')}`, name: `Fixture workflow ${String(index + 1)}`, runs, completed: runs - 3, p95Ms: 1500 + 100 * index, cost: runs * 0.0125, estimatedRuns: 0 };
  }).reverse();
}

const fixtureDigest = (seed: string): string => seed.repeat(64).slice(0, 64);
const FIXTURE_MINUTE = 60_000;

export function fixtureApprovals(tenantIds: readonly string[], now: number): PendingApprovalRow[] {
  const tenantId = tenantIds[0];
  if (tenantId === undefined) return [];
  const row = (index: number, kind: 'agent' | 'approval', capability: string, target: string, expiresInMinutes: number): PendingApprovalRow => ({
    tenantId, workspace: fixtureName(tenantId), runId: `e0000000-0000-4000-8000-${String(index).padStart(12, '0')}`, runVersion: 4 + index, definitionRevision: 2, workflowName: `Fixture workflow ${String(index)}`, runLabel: `owner/repo#${String(index)} Fixture change`, waitingKind: kind,
    waitingJson: JSON.stringify({ nodeId: kind === 'agent' ? 'agent' : 'approval', bindingDigest: fixtureDigest(String(index)), requestedAt: new Date(now - 10 * FIXTURE_MINUTE).toISOString(), expiresAt: new Date(now + expiresInMinutes * FIXTURE_MINUTE).toISOString(), review: { revision: 2, installationId: 'd0000000-0000-4000-8000-000000000001', capability, target, argumentsDigest: fixtureDigest('a'), arguments: [{ name: 'subject', type: 'string' }, { name: 'amount', type: 'number' }] } }),
  });
  return [row(1, 'approval', 'send-invoice', 'billing', 30), row(2, 'agent', 'update-record', 'crm', 55)];
}

export function fixtureHealth(tenantIds: readonly string[], now: number): HealthRows {
  const tenantId = tenantIds[0];
  if (tenantId === undefined) return { connectors: [], circuits: [], reconciliation: [] };
  const workspace = fixtureName(tenantId);
  return {
    connectors: [{ tenantId, workspace, state: 'healthy', installations: 2 }, { tenantId, workspace, state: 'offline', installations: 1 }],
    circuits: [{ tenantId, workspace, key: 'model:openrouter', state: 'open', since: new Date(now - 5 * FIXTURE_MINUTE) }],
    reconciliation: [],
  };
}
