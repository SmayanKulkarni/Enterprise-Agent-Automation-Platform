import { StackedBars } from '../charts/stacked-bars.js';
import { TimeSeriesChart } from '../charts/time-series-chart.js';
import type { RangeKey } from './decoders.js';
import type { Unit } from './governance-model.js';
import type { GovernanceSource } from './governance-source.js';
import { useSeries, type SeriesState } from './use-series.js';

export interface PanelSpec { id: string; title: string; unit: Unit; kind: 'bars' | 'lines' | 'area' }

export const OVERVIEW_PANELS: readonly PanelSpec[] = [
  { id: 'runs-over-time', title: 'Runs over time', unit: 'count', kind: 'bars' },
  { id: 'spend-by-workspace', title: 'Spend by workspace', unit: 'usd', kind: 'area' },
  { id: 'api-latency', title: 'API latency (p50, p95)', unit: 'seconds', kind: 'lines' },
  { id: 'api-error-rate', title: 'API error rate', unit: 'percent', kind: 'lines' },
  { id: 'model-latency', title: 'Model latency by provider (p95)', unit: 'seconds', kind: 'lines' },
  { id: 'judgment-bands', title: 'Judgment bands (act, review, escalate)', unit: 'count', kind: 'bars' },
  { id: 'mcp-outcomes', title: 'MCP outcomes', unit: 'count', kind: 'bars' },
];

const emptyText = {
  'not-configured': 'Telemetry is not configured for this environment.',
  unavailable: 'Telemetry is unavailable right now.',
  empty: 'No data in this period.',
  failed: 'This chart could not be loaded. Use Refresh to try again.',
  loading: 'Loading…',
} as const;

interface ViewProps { spec: PanelSpec; range: RangeKey; state: SeriesState }

export function ChartPanelView({ spec, range, state }: ViewProps) {
  const { series, failed, loading } = state;
  const hasPoints = series?.series.some((line) => line.points.length > 0) ?? false;
  const empty = failed ? emptyText.failed : series === undefined ? (loading ? emptyText.loading : emptyText.failed) : series.status !== 'ready' ? emptyText[series.status] : !hasPoints ? emptyText.empty : undefined;
  return (
    <article className="governance-card chart-card" aria-busy={loading}>
      <div className="card-heading"><div><h2>{spec.title}</h2></div></div>
      {empty !== undefined || series === undefined ? <p className="card-empty">{empty}</p> : spec.kind === 'bars' ? <StackedBars title={spec.title} series={series.series} unit={spec.unit} range={range} /> : <TimeSeriesChart title={spec.title} series={series.series} unit={spec.unit} range={range} area={spec.kind === 'area'} />}
      {series?.completeness === 'partial' && <p className="card-note">Showing the data that is retained.</p>}
    </article>
  );
}

export function ChartPanel({ source, spec, range, scope, reload }: { source: GovernanceSource; spec: PanelSpec; range: RangeKey; scope: string | undefined; reload: number }) {
  return <ChartPanelView spec={spec} range={range} state={useSeries(source, spec.id, range, scope, reload)} />;
}
