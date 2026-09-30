import { AppError } from '../../errors/src/app-error.js';
import { RANGES, type RangeKey, type SqlPanelId } from './catalog.js';

export type Numeric = number | string | null;
export interface WindowRow { window: 'current' | 'previous'; runs: Numeric; completed: Numeric; failed: Numeric; unknownOutcome: Numeric; p95Ms: Numeric; tokens: Numeric; cost: Numeric; estimatedRuns: Numeric }
export interface WorkspaceWindowRow extends WindowRow { tenantId: string; name: string }
export interface OverviewRows { workspaces: WorkspaceWindowRow[]; totals: WindowRow[]; pending: { tenantId: string; pendingApprovals: Numeric }[] }
export interface SeriesRow { tenantId: string; name: string; bucketStart: Date; completed: Numeric; failed: Numeric; unknownOutcome: Numeric; cost: Numeric; tokens: Numeric; estimatedRuns: Numeric }
export interface WorkflowRow { tenantId: string; workspace: string; definitionId: string; name: string | null; runs: Numeric; completed: Numeric; p95Ms: Numeric; cost: Numeric; estimatedRuns: Numeric }

export interface Totals { runs: number; completed: number; failed: number; unknownOutcome: number; p95Seconds: number | null; tokens: number; cost: number }
export interface Kpis extends Totals { pendingApprovals: number; previous: Totals }
export interface SeriesLine { label: string; points: [number, number][] }

const NAME_LIMIT = 128;
const corrupt = (): never => { throw new AppError('INTERNAL'); };

export function toCount(value: Numeric | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'string' ? (/^\d{1,19}$/u.test(value) ? Number(value) : corrupt()) : value;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : corrupt();
}

export function toMeasure(value: Numeric | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'string' ? (value.trim() === '' ? Number.NaN : Number(value)) : value;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed + 0 : corrupt();
}

const toSeconds = (value: Numeric | undefined): number | null => value === null || value === undefined ? null : toMeasure(value) / 1000;

const totals = (row: WindowRow | undefined): Totals => ({
  runs: toCount(row?.runs), completed: toCount(row?.completed), failed: toCount(row?.failed), unknownOutcome: toCount(row?.unknownOutcome),
  p95Seconds: toSeconds(row?.p95Ms), tokens: toCount(row?.tokens), cost: toMeasure(row?.cost),
});
const estimated = (row: WindowRow | undefined): boolean => toCount(row?.estimatedRuns) > 0;
const completeness = (isPartial: boolean): 'full' | 'partial' => isPartial ? 'partial' : 'full';
const byWindow = (rows: readonly WindowRow[], window: WindowRow['window']): WindowRow | undefined => rows.find((row) => row.window === window);

export function buildOverview(rows: OverviewRows, range: RangeKey): { range: RangeKey; workspaces: (Kpis & { tenantId: string; name: string })[]; total: Kpis; completeness: 'full' | 'partial' } {
  const pending = new Map(rows.pending.map((row) => [row.tenantId, toCount(row.pendingApprovals)]));
  const names = new Map(rows.workspaces.map((row) => [row.tenantId, row.name]));
  const kpis = (windows: readonly WindowRow[], pendingApprovals: number): Kpis => ({ ...totals(byWindow(windows, 'current')), pendingApprovals, previous: totals(byWindow(windows, 'previous')) });
  const workspaces = [...names].map(([tenantId, name]) => ({ tenantId, name, ...kpis(rows.workspaces.filter((row) => row.tenantId === tenantId), pending.get(tenantId) ?? 0) }));
  const pendingTotal = [...pending.values()].reduce((sum, value) => sum + value, 0);
  return { range, workspaces, total: kpis(rows.totals, pendingTotal), completeness: completeness(estimated(byWindow(rows.totals, 'current'))) };
}

export function windowSpan(range: RangeKey): { step: number; points: number } {
  const { ms, bucketMinutes } = RANGES[range];
  const step = bucketMinutes * 60_000;
  return { step, points: Math.ceil(ms / step) };
}

export function buildSeries(panel: SqlPanelId, range: RangeKey, rows: readonly SeriesRow[], from: number): { panel: SqlPanelId; range: RangeKey; status: 'ready'; series: SeriesLine[]; completeness: 'full' | 'partial' } {
  const { step, points } = windowSpan(range);
  const grids = new Map<string, number[]>();
  const add = (label: string, index: number, value: number): void => {
    const grid = grids.get(label) ?? new Array<number>(points).fill(0);
    grid[index] = (grid[index] ?? 0) + value; grids.set(label, grid);
  };
  if (panel === 'runs-over-time') for (const label of ['completed', 'failed', 'unknown-outcome']) grids.set(label, new Array<number>(points).fill(0));
  for (const row of rows) {
    const index = Math.floor((row.bucketStart.getTime() - from) / step);
    if (!Number.isInteger(index) || index < 0 || index >= points) continue;
    if (panel === 'runs-over-time') { add('completed', index, toCount(row.completed)); add('failed', index, toCount(row.failed)); add('unknown-outcome', index, toCount(row.unknownOutcome)); }
    else add(row.name, index, toMeasure(row.cost));
  }
  const series = [...grids].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([label, grid]) => ({ label, points: grid.map((value, index): [number, number] => [from + index * step, value]) }));
  return { panel, range, status: 'ready', series, completeness: completeness(rows.some((row) => toCount(row.estimatedRuns) > 0)) };
}

export function buildWorkflows(rows: readonly WorkflowRow[], range: RangeKey): { range: RangeKey; workflows: { tenantId: string; workspace: string; definitionId: string; name: string; runs: number; successRate: number | null; p95Seconds: number | null; cost: number }[]; completeness: 'full' | 'partial' } {
  const workflows = rows.map((row) => {
    const runs = toCount(row.runs); const name = row.name?.trim().slice(0, NAME_LIMIT);
    return { tenantId: row.tenantId, workspace: row.workspace, definitionId: row.definitionId, name: name || row.definitionId.slice(0, 8), runs, successRate: runs === 0 ? null : toCount(row.completed) / runs, p95Seconds: toSeconds(row.p95Ms), cost: toMeasure(row.cost) };
  });
  return { range, workflows, completeness: completeness(rows.some((row) => toCount(row.estimatedRuns) > 0)) };
}
