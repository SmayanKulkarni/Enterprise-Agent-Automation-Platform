import functionsInstrumentation from '@azure/functions-opentelemetry-instrumentation';
import { AzureMonitorTraceExporter } from '@azure/monitor-opentelemetry-exporter';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { TediousInstrumentation } from '@opentelemetry/instrumentation-tedious';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeTracerProvider, SimpleSpanProcessor, type ReadableSpan, type SpanProcessor } from '@opentelemetry/sdk-trace-node';

const { AzureFunctionsInstrumentation } = functionsInstrumentation;

const stripQuery: SpanProcessor = {
  onStart() {},
  onEnd(span: ReadableSpan) {
    const url = span.attributes['url.full'];
    if (typeof url !== 'string') return;
    const question = url.indexOf('?');
    if (question !== -1) span.attributes['url.full'] = url.slice(0, question);
  },
  forceFlush: async () => {},
  shutdown: async () => {},
};

const connectionString = process.env['APPLICATIONINSIGHTS_CONNECTION_STRING'];
if (connectionString) {
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'workflow-functions' }),
    spanProcessors: [stripQuery, new SimpleSpanProcessor(new AzureMonitorTraceExporter({ connectionString }))],
  });
  provider.register();
  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [new TediousInstrumentation(), new UndiciInstrumentation(), new AzureFunctionsInstrumentation()],
  });
}
