import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { metrics, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

type Telemetry = typeof import('./index.js');
interface Received { path: string; body: string }

let server: Server | undefined;
const received: Received[] = [];

async function collector(respond: boolean): Promise<string> {
  received.length = 0;
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({ path: request.url ?? '', body: Buffer.concat(chunks).toString('utf8') });
      if (respond) { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{}'); }
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

const load = async (): Promise<Telemetry> => { vi.resetModules(); return import('./index.js'); };

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => undefined); vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', ''); vi.stubEnv('APPLICATIONINSIGHTS_CONNECTION_STRING', ''); });
afterEach(async () => {
  vi.unstubAllEnvs(); vi.restoreAllMocks(); trace.disable(); metrics.disable(); logs.disable();
  server?.closeAllConnections();
  await new Promise<void>((resolve) => { if (server === undefined) resolve(); else server.close(() => { resolve(); }); });
  server = undefined;
});

test('registers nothing and does not throw with an empty environment', async () => {
  const telemetry = await load();

  expect(() => { telemetry.startTelemetry('test'); telemetry.startTelemetry('test'); }).not.toThrow();
  expect(trace.getTracer('test').startSpan('s').isRecording()).toBe(false);
  expect(metrics.getMeterProvider().constructor.name).toBe('NoopMeterProvider');
  await expect(telemetry.flushTelemetry()).resolves.toBeUndefined();
}, 30_000);

test('treats a whitespace-only endpoint as unset', async () => {
  vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '   ');
  const telemetry = await load();
  telemetry.startTelemetry('test');

  expect(trace.getTracer('test').startSpan('s').isRecording()).toBe(false);
});

test('exports traces, metrics and logs to the OTLP endpoint with the resource attributes', async () => {
  vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', await collector(true));
  vi.stubEnv('DEPLOYMENT_ENVIRONMENT', 'staging');
  const telemetry = await load();
  telemetry.startTelemetry('browser-api');
  trace.getTracer('test').startSpan('unit-span').end();
  telemetry.count('auth.denied', { reason: 'DENIED' });
  telemetry.logEvent('auth.denied', { reason: 'DENIED' });
  await telemetry.flushTelemetry();

  const paths = received.map((item) => item.path).sort();
  expect(paths).toEqual(['/v1/logs', '/v1/metrics', '/v1/traces']);
  const traceBody = received.find((item) => item.path === '/v1/traces')?.body ?? '';
  const attributes = Object.fromEntries((JSON.parse(traceBody) as { resourceSpans: { resource: { attributes: { key: string; value: { stringValue: string } }[] } }[] }).resourceSpans[0]?.resource.attributes.map((entry) => [entry.key, entry.value.stringValue]) ?? []);
  expect(attributes).toMatchObject({ 'service.name': 'browser-api', 'service.namespace': 'threadline', 'deployment.environment.name': 'staging' });
  expect(attributes['service.instance.id']).toMatch(/^[0-9a-f-]{36}$/u);
});

test('records traces for Application Insights and starts no metric provider without an OTLP endpoint', async () => {
  vi.stubEnv('APPLICATIONINSIGHTS_CONNECTION_STRING', 'InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://ingest.invalid/');
  const telemetry = await load();
  telemetry.startTelemetry('workflow-functions');

  expect(trace.getTracer('test').startSpan('unit-span').isRecording()).toBe(true);
  expect(metrics.getMeterProvider().constructor.name).toBe('NoopMeterProvider');
  await expect(telemetry.flushTelemetry()).resolves.toBeUndefined();
});

test('gives every process its own service.instance.id', async () => {
  const ids: string[] = [];
  for (let run = 0; run < 2; run += 1) {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', await collector(true));
    const telemetry = await load();
    telemetry.startTelemetry('browser-api');
    trace.getTracer('test').startSpan('s').end();
    await telemetry.flushTelemetry();
    ids.push(/"service\.instance\.id","value":\{"stringValue":"([^"]+)"/u.exec(received.find((item) => item.path === '/v1/traces')?.body ?? '')?.[1] ?? '');
    trace.disable(); metrics.disable(); logs.disable();
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => { resolve(); }));
  }

  expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/u);
  expect(ids[1]).toMatch(/^[0-9a-f-]{36}$/u);
  expect(ids[0]).not.toBe(ids[1]);
});

test('resolves within about two seconds when the exporter never answers', async () => {
  vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', await collector(false));
  const telemetry = await load();
  telemetry.startTelemetry('browser-api');
  trace.getTracer('test').startSpan('s').end();
  const started = performance.now();
  await telemetry.flushTelemetry();
  const elapsed = performance.now() - started;

  expect(elapsed).toBeGreaterThanOrEqual(1900);
  expect(elapsed).toBeLessThan(3000);
});

test('withFlush flushes after the handler and passes its result and its failure through', async () => {
  const telemetry = await load();

  await expect(telemetry.withFlush((value: number) => Promise.resolve(value + 1))(1)).resolves.toBe(2);
  await expect(telemetry.withFlush(() => Promise.reject(new Error('handler failed')))()).rejects.toThrow('handler failed');
});

test('keeps running with telemetry disabled when the endpoint is unusable', async () => {
  vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'not a url');
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const telemetry = await load();

  expect(() => { telemetry.startTelemetry('browser-api'); }).not.toThrow();
  await expect(telemetry.flushTelemetry()).resolves.toBeUndefined();
  expect(error.mock.calls.length).toBeLessThanOrEqual(1);
});
