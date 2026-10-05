import { metrics, type Attributes, type Counter, type Histogram, type MeterProvider } from '@opentelemetry/api';
import { scrub } from '../../errors/src/scrub.js';

const METER_NAME = 'threadline';
const MAX_LABEL = 128;
const SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600];
const TOKENS = [1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144];
const GEN_AI = ['gen_ai.provider.name', 'gen_ai.request.model', 'tenant_id', 'feature'] as const;

export const METRICS = {
  'http.server.request.duration': { type: 'histogram', unit: 's', buckets: SECONDS, labels: ['http.route', 'http.request.method', 'http.response.status_code', 'tenant_id'] },
  'app.errors': { type: 'counter', labels: ['code', 'category', 'site', 'tenant_id'] },
  'auth.denied': { type: 'counter', labels: ['reason'] },
  'workflow.runs.started': { type: 'counter', labels: ['tenant_id', 'trigger'] },
  'workflow.runs.finished': { type: 'counter', labels: ['tenant_id', 'status', 'reason'] },
  'workflow.step.duration': { type: 'histogram', unit: 's', buckets: SECONDS, labels: ['tenant_id', 'node_kind', 'outcome'] },
  'workflow.approvals.requested': { type: 'counter', labels: ['tenant_id', 'kind'] },
  'workflow.approvals.decided': { type: 'counter', labels: ['tenant_id', 'decision'] },
  'workflow.approvals.expired': { type: 'counter', labels: ['tenant_id'] },
  'workflow.approval.wait.duration': { type: 'histogram', unit: 's', buckets: SECONDS, labels: ['tenant_id', 'decision'] },
  'gen_ai.client.operation.duration': { type: 'histogram', unit: 's', buckets: SECONDS, labels: [...GEN_AI, 'error.type'] },
  'gen_ai.client.token.usage': { type: 'histogram', unit: '{token}', buckets: TOKENS, labels: [...GEN_AI, 'error.type', 'gen_ai.token.type'] },
  'gen_ai.client.cost': { type: 'counter', unit: 'USD', labels: GEN_AI },
  'workflow.judgment.bands': { type: 'counter', labels: ['tenant_id', 'band', 'question_type'] },
  'mcp.tool.call.duration': { type: 'histogram', unit: 's', buckets: SECONDS, labels: ['tenant_id', 'capability', 'outcome', 'route'] },
  'workflow.effects': { type: 'counter', labels: ['tenant_id', 'state'] },
  'workflow.circuit.transitions': { type: 'counter', labels: ['tenant_id', 'kind', 'state'] },
  'workflow.webhook.deliveries': { type: 'counter', labels: ['tenant_id', 'outcome'] },
  'connector.agent.requests': { type: 'counter', labels: ['tenant_id', 'operation', 'outcome'] },
  'memory.retrievals': { type: 'counter', labels: ['tenant_id', 'status'] },
  'memory.proposals': { type: 'counter', labels: ['tenant_id', 'state'] },
  'memory.summaries': { type: 'counter', labels: ['tenant_id', 'outcome'] },
  'memory.consolidation': { type: 'counter', labels: ['tenant_id', 'decision', 'path'] },
  'workflow.dispatch.recovered': { type: 'counter', labels: [] },
} as const;

type Catalog = typeof METRICS;
type NamesOf<Type extends 'counter' | 'histogram'> = { [Name in keyof Catalog]: Catalog[Name]['type'] extends Type ? Name : never }[keyof Catalog];
export type CounterName = NamesOf<'counter'>;
export type HistogramName = NamesOf<'histogram'>;
export type MetricLabels<Name extends keyof Catalog> = Partial<Record<Catalog[Name]['labels'][number], string | number | undefined>>;

let cachedProvider: MeterProvider | undefined;
const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();

function meter() {
  const provider = metrics.getMeterProvider();
  if (provider !== cachedProvider) { counters.clear(); histograms.clear(); cachedProvider = provider; }
  return provider.getMeter(METER_NAME);
}

function attributesOf(name: keyof Catalog, labels: Readonly<Record<string, string | number | undefined>>): Attributes {
  const allowed: readonly string[] = METRICS[name].labels;
  const attributes: Attributes = {};
  for (const [key, value] of Object.entries(labels)) {
    if (!allowed.includes(key)) continue;
    if (typeof value === 'string') attributes[key] = scrub(value, MAX_LABEL);
    else if (typeof value === 'number' && Number.isFinite(value)) attributes[key] = value;
  }
  return attributes;
}

export function count<Name extends CounterName>(name: Name, labels: MetricLabels<Name> = {}, value = 1): void {
  if (!Number.isFinite(value) || value < 0) return;
  const active = meter(); let instrument = counters.get(name);
  if (instrument === undefined) { const { unit } = METRICS[name] as { unit?: string }; instrument = active.createCounter(name, unit === undefined ? {} : { unit }); counters.set(name, instrument); }
  instrument.add(value, attributesOf(name, labels));
}

export function record<Name extends HistogramName>(name: Name, value: number, labels: MetricLabels<Name> = {}): void {
  if (!Number.isFinite(value) || value < 0) return;
  const active = meter(); let instrument = histograms.get(name);
  if (instrument === undefined) { const spec = METRICS[name]; instrument = active.createHistogram(name, { unit: spec.unit, advice: { explicitBucketBoundaries: [...spec.buckets] } }); histograms.set(name, instrument); }
  instrument.record(value, attributesOf(name, labels));
}
