import { AppError } from '../../errors/src/app-error.js';
import { EVENTS, projectEvent } from '../../telemetry/src/events.js';
import { backendJson, guarded, isObject, type QueryBackend, type Unready } from './backend.js';
import { tenantPattern, UUID } from './scope.js';

export const LEVELS = ['info', 'warn', 'error'] as const;
export interface LogFilters { level?: string; event?: string; run?: string }
export interface LogEntry { at: string; ns: string; event: string; level: string; attributes: Record<string, string | number | boolean> }
export type LogsResult = { status: 'ready'; entries: LogEntry[] } | (Unready & { entries: [] });

const NUMERIC = /^-?\d+(?:\.\d+)?$/u;
const NUMERIC_KEYS = new Set(['status', 'attempt', 'tokens', 'cost', 'duration_s', 'wait_s', 'item_count']);
const NS_PER_MS = 1_000_000n;
const shape = (): never => { throw new Error('Unexpected Loki response.'); };
const invalid = (): never => { throw new AppError('INVALID'); };

export function lokiQuery(pattern: string, filters: LogFilters): string {
  const { level, event, run } = filters;
  if (level !== undefined && !(LEVELS as readonly string[]).includes(level)) invalid();
  if (event !== undefined && !Object.hasOwn(EVENTS, event)) invalid();
  if (run !== undefined && !UUID.test(run)) invalid();
  const clauses = [`tenant_id=~"${tenantPattern(pattern.split('|'))}"`, ...(level === undefined ? [] : [`level="${level}"`]), ...(event === undefined ? [] : [`event="${event}"`]), ...(run === undefined ? [] : [`run_id="${run}"`])];
  return `{service_namespace="threadline"} | ${clauses.join(' | ')}`;
}

const asString = (record: Record<string, unknown>, key: string): string | undefined => typeof record[key] === 'string' ? record[key] : undefined;

function entry(stream: Record<string, unknown>, value: unknown): LogEntry | undefined {
  if (!Array.isArray(value) || typeof value[0] !== 'string' || !/^\d{1,20}$/u.test(value[0]) || typeof value[1] !== 'string') return shape();
  const metadata = isObject(value[2]) ? value[2] : {};
  const merged: Record<string, unknown> = { ...stream, ...metadata };
  for (const key of NUMERIC_KEYS) if (typeof merged[key] === 'string' && NUMERIC.test(merged[key])) merged[key] = Number(merged[key]);
  const event = asString(merged, 'event') ?? value[1];
  const attributes = projectEvent(event, merged);
  if (attributes === undefined) return undefined;
  const level = asString(merged, 'level');
  return { at: new Date(Number(BigInt(value[0]) / NS_PER_MS)).toISOString(), ns: value[0], event, level: (LEVELS as readonly string[]).includes(level ?? '') ? level as string : 'info', attributes };
}

function parse(body: unknown): LogEntry[] {
  const data = isObject(body) && body['status'] === 'success' ? body['data'] : shape();
  const result = isObject(data) && data['resultType'] === 'streams' && Array.isArray(data['result']) ? data['result'] as unknown[] : shape();
  const entries = result.flatMap((item) => {
    if (!isObject(item) || !isObject(item['stream']) || !Array.isArray(item['values'])) return shape();
    const stream = item['stream'];
    return (item['values'] as unknown[]).map((value) => entry(stream, value));
  });
  return entries.filter((item): item is LogEntry => item !== undefined).sort((a, b) => BigInt(b.ns) > BigInt(a.ns) ? 1 : BigInt(b.ns) < BigInt(a.ns) ? -1 : 0);
}

export async function lokiLogs(backend: QueryBackend, query: string, fromNs: bigint, toNs: bigint, limit: number): Promise<LogsResult> {
  const outcome = await guarded('governance.loki', backend, async () => ({ status: 'ready' as const, entries: parse(await backendJson(backend, '/loki/api/v1/query_range', { query, start: String(fromNs), end: String(toNs), limit: String(limit), direction: 'backward' }, 'GET')) }));
  return outcome.status === 'ready' ? outcome : { status: outcome.status, entries: [] };
}

export const encodeLogCursor = (groupId: string, beforeNs: string): string => Buffer.from(`${groupId}.${JSON.stringify({ before: beforeNs })}`).toString('base64url');

export function decodeLogCursor(value: string, groupId: string): bigint {
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  const separator = decoded.indexOf('.');
  if (separator < 1 || decoded.slice(0, separator) !== groupId) throw new AppError('DENIED');
  try {
    const parsed: unknown = JSON.parse(decoded.slice(separator + 1));
    const before = isObject(parsed) ? parsed['before'] : undefined;
    if (typeof before === 'string' && /^[0-9]{1,20}$/u.test(before)) return BigInt(before);
  } catch { return invalid(); }
  return invalid();
}
