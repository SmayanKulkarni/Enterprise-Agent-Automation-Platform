import { backendJson, guarded, isObject, type QueryBackend, type Unready } from './backend.js';
import type { PanelQuery } from './catalog.js';

export interface SeriesLine { label: string; points: [number, number][] }
export type SeriesResult = { status: 'ready'; series: SeriesLine[] } | (Unready & { series: [] });

const MAX_POINTS = 300;
const MAX_SERIES = 20;
const shape = (): never => { throw new Error('Unexpected Prometheus response.'); };

function points(values: unknown): [number, number][] {
  if (!Array.isArray(values)) return shape();
  return values.flatMap((pair): [number, number][] => {
    if (!Array.isArray(pair) || typeof pair[0] !== 'number' || typeof pair[1] !== 'string') return shape();
    const value = Number(pair[1]);
    return Number.isFinite(value) ? [[pair[0] * 1000, value]] : [];
  }).slice(0, MAX_POINTS);
}

function lines(body: unknown, query: PanelQuery): SeriesLine[] {
  const data = isObject(body) && body['status'] === 'success' ? body['data'] : shape();
  const result = isObject(data) && data['resultType'] === 'matrix' && Array.isArray(data['result']) ? data['result'] as unknown[] : shape();
  return result.map((item) => {
    if (!isObject(item) || !isObject(item['metric'])) return shape();
    const metric = item['metric'];
    const named = (query.by ?? []).map((name) => metric[name]).filter((value): value is string => typeof value === 'string' && value !== '');
    return { label: named.length > 0 ? named.join(' / ') : query.label, points: points(item['values']) };
  });
}

export async function prometheusRange(backend: QueryBackend, queries: readonly PanelQuery[], fromMs: number, toMs: number, stepSeconds: number): Promise<SeriesResult> {
  const outcome = await guarded('governance.prometheus', backend, async () => {
    const bodies = await Promise.all(queries.map((query) => backendJson(backend, '/api/v1/query_range', { query: query.query, start: String(fromMs / 1000), end: String(toMs / 1000), step: String(stepSeconds) }, 'POST')));
    return { status: 'ready' as const, series: bodies.flatMap((body, index) => lines(body, queries[index] as PanelQuery)).slice(0, MAX_SERIES) };
  });
  return outcome.status === 'ready' ? outcome : { status: outcome.status, series: [] };
}
