import { metrics } from '@opentelemetry/api';
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { afterEach, expect, test, vi } from 'vitest';
import { classify } from './classify.js';
import { report } from './report.js';
import { reported } from './swallow.js';

afterEach(() => { vi.restoreAllMocks(); metrics.disable(); });

const lines = (spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] => spy.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);

test('logs 4xx at warn without a stack', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  report(new Error('DENIED'), { correlationId: 'c1', tenantId: 't1', method: 'GET', route: '/api/v1/session' });
  expect(lines(warn)).toEqual([expect.objectContaining({ correlationId: 'c1', tenantId: 't1', method: 'GET', route: '/api/v1/session', status: 403, code: 'DENIED', category: 'denied' })]);
  expect(lines(warn)[0]).not.toHaveProperty('stack');
});

test('logs 5xx at error with a stack and redacts bearer tokens', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  report(new Error('upstream said Bearer abc.def.ghi rejected'), { correlationId: 'c2' });
  const [line] = lines(error);
  expect(line).toMatchObject({ status: 500, code: 'INTERNAL' });
  expect(line).toHaveProperty('stack');
  expect(JSON.stringify(line)).not.toContain('abc.def.ghi');
});

test('logs an error once even when reported twice', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const app = classify(new Error('STALE'));
  report(app, { correlationId: 'c3' });
  report(app, { correlationId: 'c3' });
  expect(warn).toHaveBeenCalledTimes(1);
});

test('reported returns the fallback and reports once with the site', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(reported([] as string[], 'runtime.proposals')(new Error('boom'))).toEqual([]);
  expect(lines(error)).toEqual([expect.objectContaining({ site: 'runtime.proposals' })]);
});

test('keeps a multi-frame stack and redacts key=value secrets', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const cause = new Error('connect failed password=hunter2 api-key: abc123');
  cause.stack = `Error: ${cause.message}\n${'    at frame (file.ts:1:1)\n'.repeat(30)}`;
  report(cause, { correlationId: 'c4' });
  const [line] = lines(error);
  expect(String(line?.['stack']).split('\n').length).toBeGreaterThan(20);
  expect(JSON.stringify(line)).not.toMatch(/hunter2|abc123/u);
});

const eventLines = (spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] => lines(spy).filter((line) => typeof line['event'] === 'string');

function registerMetrics() {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const provider = new MeterProvider({ readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000, exportTimeoutMillis: 30_000 })] });
  metrics.setGlobalMeterProvider(provider);
  return async () => { await provider.forceFlush(); return exporter.getMetrics().flatMap((batch) => batch.scopeMetrics.flatMap((scope) => scope.metrics)).filter((metric) => metric.descriptor.name === 'app.errors').flatMap((metric) => metric.dataPoints.map((point) => ({ value: point.value, attributes: point.attributes }))); };
}

test('emits api.request.failed once per error at warn for 4xx and error for 5xx', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const denied = classify(new Error('DENIED'));
  report(denied, { correlationId: 'c5', tenantId: 't1', method: 'GET', route: '/api/v1/session' });
  report(denied, { correlationId: 'c5' });
  report(new Error('boom'), { correlationId: 'c6' });

  expect(eventLines(log)).toEqual([
    expect.objectContaining({ event: 'api.request.failed', level: 'warn', tenant_id: 't1', route: '/api/v1/session', method: 'GET', status: 403, code: 'DENIED', category: 'denied', correlation_id: 'c5' }),
    expect.objectContaining({ event: 'api.request.failed', level: 'error', status: 500, code: 'INTERNAL', correlation_id: 'c6' }),
  ]);
});

test('keeps the console line free of the tenantVerified flag', () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  report(new Error('DENIED'), { correlationId: 'c7', tenantId: 't1', tenantVerified: true });

  expect(lines(warn)[0]).not.toHaveProperty('tenantVerified');
  expect(lines(warn)[0]).toMatchObject({ tenantId: 't1' });
});

test('counts app.errors without a tenant label when the tenant came from the URL', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const exported = registerMetrics();
  report(new Error('DENIED'), { correlationId: 'c8', tenantId: 'forged-tenant' });

  expect(await exported()).toEqual([{ value: 1, attributes: { code: 'DENIED', category: 'denied' } }]);
});

test.each([
  ['a worker call site', { site: 'workflowStep', tenantId: 't1' }, { code: 'INTERNAL', category: 'terminal', site: 'workflowStep', tenant_id: 't1' }],
  ['a verified tenant', { tenantVerified: true, tenantId: 't1' }, { code: 'INTERNAL', category: 'terminal', tenant_id: 't1' }],
  ['a worker call site without a tenant', { site: 'workflowDispatchRecovery' }, { code: 'INTERNAL', category: 'terminal', site: 'workflowDispatchRecovery' }],
  ['tenantVerified without a tenant', { tenantVerified: true }, { code: 'INTERNAL', category: 'terminal' }],
])('counts app.errors with the tenant label for %s', async (_name, context, attributes) => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const exported = registerMetrics();
  report(new Error('boom'), { correlationId: 'c9', ...context });

  expect(await exported()).toEqual([{ value: 1, attributes }]);
});

test('counts a repeated report of the same error once', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const exported = registerMetrics();
  const app = classify(new Error('STALE'));
  report(app, { correlationId: 'c10' });
  report(app, { correlationId: 'c10' });

  expect(await exported()).toEqual([{ value: 1, attributes: { code: 'STALE', category: 'conflict' } }]);
});
