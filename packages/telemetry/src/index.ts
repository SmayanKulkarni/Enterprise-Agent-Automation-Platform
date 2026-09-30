import { randomUUID } from 'node:crypto';
import { AzureMonitorTraceExporter } from '@azure/monitor-opentelemetry-exporter';
import { metrics } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations, type Instrumentation } from '@opentelemetry/instrumentation';
import { TediousInstrumentation } from '@opentelemetry/instrumentation-tedious';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeTracerProvider, SimpleSpanProcessor, type ReadableSpan, type SpanProcessor } from '@opentelemetry/sdk-trace-node';
import { scrub } from '../../errors/src/scrub.js';
import { FLUSH_TIMEOUT_MS, flushWithin } from './flush.js';

export { count, record, METRICS } from './instruments.js';
export { logEvent, projectEvent, EVENTS } from './events.js';

const METRIC_EXPORT_INTERVAL_MS = 15_000;
const METRIC_EXPORT_TIMEOUT_MS = 10_000;

interface Flushable { forceFlush(): Promise<void> }

let started = false;
let flushables: readonly Flushable[] = [];

const stripQuery: SpanProcessor = {
  onStart() {},
  onEnd(span: ReadableSpan) {
    const url = span.attributes['url.full'];
    if (typeof url !== 'string') return;
    const question = url.indexOf('?');
    if (question !== -1) span.attributes['url.full'] = url.slice(0, question);
  },
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

export function startTelemetry(serviceName: string, instrumentations: readonly Instrumentation[] = []): void {
  if (started) return;
  started = true;
  const otlp = Boolean(process.env['OTEL_EXPORTER_OTLP_ENDPOINT']?.trim());
  const connectionString = process.env['APPLICATIONINSIGHTS_CONNECTION_STRING']?.trim();
  if (!otlp && !connectionString) return;
  try {
    const resource = resourceFromAttributes({
      'service.name': serviceName,
      'service.namespace': 'threadline',
      'deployment.environment.name': process.env['DEPLOYMENT_ENVIRONMENT']?.trim() || 'unknown',
      'service.instance.id': randomUUID(),
    });
    const tracer = new NodeTracerProvider({ resource, spanProcessors: [stripQuery, ...(otlp ? [new SimpleSpanProcessor(new OTLPTraceExporter())] : []), ...(connectionString ? [new SimpleSpanProcessor(new AzureMonitorTraceExporter({ connectionString }))] : [])] });
    const meter = otlp ? new MeterProvider({ resource, readers: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS, exportTimeoutMillis: METRIC_EXPORT_TIMEOUT_MS })] }) : undefined;
    const logger = otlp ? new LoggerProvider({ resource, processors: [new SimpleLogRecordProcessor({ exporter: new OTLPLogExporter() })] }) : undefined;
    tracer.register();
    if (meter !== undefined) metrics.setGlobalMeterProvider(meter);
    if (logger !== undefined) logs.setGlobalLoggerProvider(logger);
    registerInstrumentations({ tracerProvider: tracer, instrumentations: [new TediousInstrumentation(), new UndiciInstrumentation(), ...instrumentations] });
    flushables = [tracer, ...(meter === undefined ? [] : [meter]), ...(logger === undefined ? [] : [logger])];
  } catch (error) {
    console.error(JSON.stringify({ event: 'telemetry.disabled', reason: scrub(error instanceof Error ? error.message : error) }));
  }
}

export function flushTelemetry(): Promise<void> {
  return flushWithin(flushables.map((provider) => () => provider.forceFlush()), FLUSH_TIMEOUT_MS);
}

export function withFlush<Args extends unknown[], Result>(handler: (...args: Args) => Promise<Result>): (...args: Args) => Promise<Result> {
  return async (...args) => { try { return await handler(...args); } finally { await flushTelemetry(); } };
}
