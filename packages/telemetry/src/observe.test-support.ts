import { metrics, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { vi } from 'vitest';

export interface Point { attributes: Record<string, unknown>; value: unknown }

export function observe() {
  const exported = new InMemorySpanExporter();
  const tracer = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exported)] });
  tracer.register();
  const spans = async () => { await tracer.forceFlush(); return exported.getFinishedSpans(); };
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const meter = new MeterProvider({ readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000, exportTimeoutMillis: 30_000 })] });
  metrics.setGlobalMeterProvider(meter);
  const records = new InMemoryLogRecordExporter();
  logs.setGlobalLoggerProvider(new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter: records })] }));
  const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const points = async (name: string): Promise<Point[]> => {
    await meter.forceFlush();
    return exporter.getMetrics().slice(-1).flatMap((batch) => batch.scopeMetrics.flatMap((scope) => scope.metrics)).filter((metric) => metric.descriptor.name === name).flatMap((metric) => metric.dataPoints as Point[]);
  };
  const events = (name: string): Record<string, unknown>[] => stdout.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>).filter((line) => line['event'] === name);
  const everything = async (): Promise<string> => {
    await meter.forceFlush();
    return JSON.stringify({ spans: (await spans()).map((span) => ({ name: span.name, attributes: span.attributes, events: span.events, status: span.status })), metrics: exporter.getMetrics().map((batch) => batch.scopeMetrics), logs: records.getFinishedLogRecords().map((record) => ({ body: record.body, attributes: record.attributes })), stdout: stdout.mock.calls });
  };
  return { spans, points, events, everything };
}

export function resetObservers(): void {
  vi.restoreAllMocks();
  trace.disable(); metrics.disable(); logs.disable();
}
