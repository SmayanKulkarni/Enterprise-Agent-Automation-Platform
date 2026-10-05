import { metrics } from '@opentelemetry/api';
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { afterEach, expect, test } from 'vitest';
import { METRICS, count, record } from './instruments.js';

afterEach(() => { metrics.disable(); });

function register() {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const provider = new MeterProvider({ readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000, exportTimeoutMillis: 30_000 })] });
  metrics.setGlobalMeterProvider(provider);
  return { provider, exported: async () => { await provider.forceFlush(); return exporter.getMetrics().flatMap((batch) => batch.scopeMetrics.flatMap((scope) => scope.metrics)); } };
}

test('records a point through instruments created after the provider was registered', async () => {
  const { exported } = register();
  count('auth.denied', { reason: 'DENIED' });
  count('auth.denied', { reason: 'DENIED' }, 2);

  const [metric] = await exported();
  expect(metric?.descriptor.name).toBe('auth.denied');
  expect(metric?.dataPoints.map((point) => ({ value: point.value, attributes: point.attributes }))).toEqual([{ value: 3, attributes: { reason: 'DENIED' } }]);
});

test('records a histogram with second-scale bucket boundaries', async () => {
  const { exported } = register();
  record('http.server.request.duration', 0.2, { 'http.route': '/api/v1/session', 'http.request.method': 'GET', 'http.response.status_code': 200 });

  const [metric] = await exported();
  const [point] = metric?.dataPoints ?? [];
  expect(metric?.descriptor.unit).toBe('s');
  expect(point?.attributes).toEqual({ 'http.route': '/api/v1/session', 'http.request.method': 'GET', 'http.response.status_code': 200 });
  expect((point?.value as { count: number; buckets: { boundaries: number[] } }).count).toBe(1);
  expect((point?.value as { buckets: { boundaries: number[] } }).buckets.boundaries.slice(0, 3)).toEqual([0.005, 0.01, 0.025]);
});

test('drops a label outside the metric catalog, so a run id can never become a series', async () => {
  const { exported } = register();
  count('workflow.runs.started', { tenant_id: 't1', trigger: 'manual', run_id: 'r1', user_id: 'u1' } as never);

  const [metric] = await exported();
  expect(metric?.dataPoints[0]?.attributes).toEqual({ tenant_id: 't1', trigger: 'manual' });
});

test('drops undefined labels and scrubs string label values', async () => {
  const { exported } = register();
  count('app.errors', { code: 'INTERNAL', category: 'terminal', site: undefined, tenant_id: 'Bearer abc.def' });

  const [metric] = await exported();
  expect(metric?.dataPoints[0]?.attributes).toEqual({ code: 'INTERNAL', category: 'terminal', tenant_id: '[redacted]' });
});

test.each([[-1], [NaN], [Infinity]])('ignores the counter increment %s', async (value) => {
  const { exported } = register();
  count('auth.denied', { reason: 'DENIED' }, value);

  expect(await exported()).toEqual([]);
});

test('ignores a non-finite or negative histogram value', async () => {
  const { exported } = register();
  record('workflow.step.duration', NaN);
  record('workflow.step.duration', -0.5);

  expect(await exported()).toEqual([]);
});

test('moves to a new provider when the global provider changes', async () => {
  const first = register();
  count('auth.denied', { reason: 'DENIED' });
  await first.exported();
  metrics.disable();
  const second = register();
  count('auth.denied', { reason: 'DENIED' });

  expect((await second.exported())[0]?.dataPoints[0]?.value).toBe(1);
});

test('does nothing and does not throw with no provider registered', () => {
  expect(() => { count('auth.denied', { reason: 'DENIED' }); record('workflow.step.duration', 1); }).not.toThrow();
});

test('defines the whole catalog of the spec', () => {
  expect(Object.keys(METRICS).sort()).toEqual([
    'app.errors', 'auth.denied', 'connector.agent.requests', 'gen_ai.client.cost', 'gen_ai.client.operation.duration', 'gen_ai.client.token.usage',
    'http.server.request.duration', 'mcp.tool.call.duration', 'memory.consolidation', 'memory.proposals', 'memory.retrievals', 'memory.summaries', 'workflow.approval.wait.duration',
    'workflow.approvals.decided', 'workflow.approvals.expired', 'workflow.approvals.requested', 'workflow.circuit.transitions', 'workflow.dispatch.recovered',
    'workflow.effects', 'workflow.runs.finished', 'workflow.runs.started', 'workflow.step.duration', 'workflow.webhook.deliveries',
  ]);
  for (const spec of Object.values(METRICS)) expect(spec.labels).not.toContain('run_id');
});
