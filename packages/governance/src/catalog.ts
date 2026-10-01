export const RANGES = {
  '1h': { ms: 3_600_000, bucketMinutes: 1 },
  '24h': { ms: 86_400_000, bucketMinutes: 5 },
  '7d': { ms: 604_800_000, bucketMinutes: 60 },
  '30d': { ms: 2_592_000_000, bucketMinutes: 180 },
} as const;
export type RangeKey = keyof typeof RANGES;

export const PANELS = {
  'runs-over-time': 'sql',
  'spend-by-workspace': 'sql',
  'api-latency': 'prometheus',
  'api-error-rate': 'prometheus',
  'api-throughput': 'prometheus',
  'model-latency': 'prometheus',
  'model-errors': 'prometheus',
  'tokens-by-model': 'prometheus',
  'mcp-outcomes': 'prometheus',
  'approval-wait': 'prometheus',
  'circuit-transitions': 'prometheus',
  'logs': 'loki',
  'trace': 'tempo',
} as const;
export type PanelId = keyof typeof PANELS;
export type SqlPanelId = { [Id in PanelId]: (typeof PANELS)[Id] extends 'sql' ? Id : never }[PanelId];

export const isRange = (value: string): value is RangeKey => Object.hasOwn(RANGES, value);
export const isPanel = (value: string): value is PanelId => Object.hasOwn(PANELS, value);
export const isSqlPanel = (value: PanelId): value is SqlPanelId => PANELS[value] === 'sql';

export interface PanelQuery { label: string; query: string; by?: readonly string[] }
type Build = (matcher: string, stepSeconds: number, rangeSeconds: number) => readonly PanelQuery[];

const MIN_WINDOW_SECONDS = 300;
const window = (stepSeconds: number): string => `${String(Math.max(stepSeconds, MIN_WINDOW_SECONDS))}s`;
const quantile = (q: number, metric: string, matcher: string, step: number, by = ''): string => `histogram_quantile(${String(q)}, sum by (le${by}) (rate(${metric}_bucket{${matcher}}[${window(step)}])))`;
const API = 'http_server_request_duration_seconds';
const MODEL = 'gen_ai_client_operation_duration_seconds';
const WAIT = 'workflow_approval_wait_duration_seconds';

const BUILDERS = {
  'api-latency': (m, step) => [{ label: 'p50', query: quantile(0.5, API, m, step) }, { label: 'p95', query: quantile(0.95, API, m, step) }],
  'api-error-rate': (m, step) => [{ label: 'error rate', query: `sum(rate(${API}_count{${m}, http_response_status_code=~"5.."}[${window(step)}])) / sum(rate(${API}_count{${m}}[${window(step)}]))` }],
  'api-throughput': (m, step) => [{ label: 'requests', query: `sum by (tenant_id) (rate(${API}_count{${m}}[${window(step)}]))`, by: ['tenant_id'] }],
  'model-latency': (m, step) => [{ label: 'p95', query: quantile(0.95, MODEL, m, step, ', gen_ai_provider_name'), by: ['gen_ai_provider_name'] }],
  'model-errors': (m, step) => [{ label: 'errors', query: `sum by (gen_ai_provider_name) (rate(${MODEL}_count{${m}, error_type!=""}[${window(step)}]))`, by: ['gen_ai_provider_name'] }],
  'tokens-by-model': (m, step) => [{ label: 'tokens', query: `sum by (gen_ai_request_model) (increase(gen_ai_client_token_usage_sum{${m}}[${window(step)}]))`, by: ['gen_ai_request_model'] }],
  'mcp-outcomes': (m, step) => [{ label: 'calls', query: `sum by (outcome) (increase(mcp_tool_call_duration_seconds_count{${m}}[${window(step)}]))`, by: ['outcome'] }],
  'approval-wait': (m, step) => [{ label: 'p50', query: quantile(0.5, WAIT, m, step) }, { label: 'p95', query: quantile(0.95, WAIT, m, step) }],
  'circuit-transitions': (m, _step, range) => [{ label: 'transitions', query: `sum by (kind, state) (increase(workflow_circuit_transitions_total{${m}}[${String(range)}s]))`, by: ['kind', 'state'] }],
} satisfies Record<string, Build>;
export type PrometheusPanelId = keyof typeof BUILDERS;
export const PROMETHEUS_PANELS: Readonly<Record<PrometheusPanelId, Build>> = BUILDERS;
export const isPrometheusPanel = (value: PanelId): value is PrometheusPanelId => PANELS[value] === 'prometheus';
