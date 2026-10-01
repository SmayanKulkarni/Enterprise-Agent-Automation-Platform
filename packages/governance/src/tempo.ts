import { backendJson, guarded, isObject, type QueryBackend, type Unready } from './backend.js';
import { tenantPattern } from './scope.js';

export interface Span { traceId: string; spanId: string; parentSpanId?: string; name: string; startMs: number; durationMs: number; status: 'ok' | 'error' | 'unset'; attributes: Record<string, string | number | boolean> }
export type TraceResult = { status: 'ready'; spans: Span[] } | (Unready & { spans: [] });

const MAX_TRACES = 20;
const MAX_SPANS = 500;
const SEARCH_WINDOW_SECONDS = 7 * 24 * 3600;
const ATTRIBUTES = new Set(['tenant_id', 'workflow.run_id', 'workflow.node_id', 'node_kind', 'outcome', 'capability', 'route', 'feature', 'gen_ai.provider.name', 'gen_ai.request.model', 'gen_ai.operation.name', 'http.route', 'http.request.method', 'http.response.status_code', 'error.type']);
const NS_PER_MS = 1_000_000n;
const NS_PER_US = 1000n;
const shape = (): never => { throw new Error('Unexpected Tempo response.'); };

const hex = (value: unknown, hexLength: number): string => {
  if (typeof value !== 'string' || value === '') return shape();
  return value.length === hexLength && /^[0-9a-f]+$/iu.test(value) ? value.toLowerCase() : Buffer.from(value, 'base64').toString('hex');
};

function attribute(value: unknown): string | number | boolean | undefined {
  if (!isObject(value)) return undefined;
  if (typeof value['stringValue'] === 'string') return value['stringValue'];
  if (typeof value['boolValue'] === 'boolean') return value['boolValue'];
  const number = Number(value['intValue'] ?? value['doubleValue']);
  return value['intValue'] !== undefined || value['doubleValue'] !== undefined ? Number.isFinite(number) ? number : undefined : undefined;
}

const status = (value: unknown): Span['status'] => {
  const code = isObject(value) ? value['code'] : undefined;
  return code === 1 || code === 'STATUS_CODE_OK' ? 'ok' : code === 2 || code === 'STATUS_CODE_ERROR' ? 'error' : 'unset';
};

function toSpan(raw: unknown): Span {
  if (!isObject(raw) || typeof raw['name'] !== 'string') return shape();
  const start = BigInt(String(raw['startTimeUnixNano']));
  const end = BigInt(String(raw['endTimeUnixNano']));
  const attributes: Span['attributes'] = {};
  for (const item of Array.isArray(raw['attributes']) ? raw['attributes'] as unknown[] : []) {
    if (!isObject(item) || typeof item['key'] !== 'string' || !ATTRIBUTES.has(item['key'])) continue;
    const value = attribute(item['value']);
    if (value !== undefined) attributes[item['key']] = value;
  }
  const parent = raw['parentSpanId'];
  return { traceId: hex(raw['traceId'], 32), spanId: hex(raw['spanId'], 16), ...(typeof parent === 'string' && parent !== '' ? { parentSpanId: hex(parent, 16) } : {}), name: raw['name'], startMs: Number(start / NS_PER_MS), durationMs: Number((end - start) / NS_PER_US) / 1000, status: status(raw['status']), attributes };
}

function spansOf(body: unknown): Span[] {
  if (!isObject(body)) return shape();
  const batches = body['batches'] ?? body['resourceSpans'];
  if (batches === undefined) return [];
  if (!Array.isArray(batches)) return shape();
  return (batches as unknown[]).flatMap((batch) => isObject(batch) && Array.isArray(batch['scopeSpans']) ? (batch['scopeSpans'] as unknown[]).flatMap((scope) => isObject(scope) && Array.isArray(scope['spans']) ? (scope['spans'] as unknown[]).map(toSpan) : []) : []);
}

function traceIds(body: unknown): string[] {
  if (!isObject(body) || !Array.isArray(body['traces'])) return shape();
  return (body['traces'] as unknown[]).slice(0, MAX_TRACES).map((trace) => isObject(trace) && typeof trace['traceID'] === 'string' && /^[0-9a-f]{1,32}$/iu.test(trace['traceID']) ? trace['traceID'] : shape());
}

export async function tempoTrace(backend: QueryBackend, runId: string, pattern: string, tenantIds: readonly string[]): Promise<TraceResult> {
  const members = new Set(tenantIds.map((id) => id.toLowerCase()));
  const outcome = await guarded('governance.tempo', backend, async () => {
    const end = Math.floor(Date.now() / 1000);
    const found = await backendJson(backend, '/api/search', { q: `{ span.workflow.run_id = "${runId}" && span.tenant_id =~ "${tenantPattern(pattern.split('|'))}" }`, limit: String(MAX_TRACES), start: String(end - SEARCH_WINDOW_SECONDS), end: String(end) }, 'GET');
    const bodies = await Promise.all(traceIds(found).map((id) => backendJson(backend, `/api/traces/${id}`, {}, 'GET')));
    const spans = bodies.flatMap(spansOf).filter((span) => {
      const tenant = span.attributes['tenant_id'];
      return tenant === undefined || members.has(String(tenant).toLowerCase());
    });
    return { status: 'ready' as const, spans: spans.sort((a, b) => a.startMs - b.startMs).slice(0, MAX_SPANS) };
  });
  return outcome.status === 'ready' ? outcome : { status: outcome.status, spans: [] };
}
