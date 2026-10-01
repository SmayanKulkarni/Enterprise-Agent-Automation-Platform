import { describeError, PlatformApiError, type PlatformCommand, type Tenant } from '../platform-api.js';
import type { Approval, ChatMessage, Classification, Completeness, Group, Health, Kpis, RangeKey, SeriesStatus, Span } from './decoders.js';
import type { GroupCommandName } from './governance-api.js';

export type Unit = 'count' | 'percent' | 'seconds' | 'usd';
export type Direction = 'up' | 'down' | 'flat' | 'none';
export interface Delta { text: string; direction: Direction }
export interface KpiTile { id: string; label: string; unit: Unit; value: number | null; previous: number | null; change: Delta; goodWhenUp: boolean }

export const DASH = '—';
export const RANGES: readonly RangeKey[] = ['1h', '24h', '7d', '30d'];
const rangeNames: Record<RangeKey, string> = { '1h': 'Last hour', '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days' };
export const rangeName = (range: RangeKey): string => rangeNames[range];

const count = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat('en', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const seconds = new Intl.NumberFormat('en', { style: 'unit', unit: 'second', unitDisplay: 'narrow', maximumFractionDigits: 2 });
const millis = new Intl.NumberFormat('en', { style: 'unit', unit: 'millisecond', unitDisplay: 'narrow', maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedPercent = new Intl.NumberFormat('en', { style: 'percent', signDisplay: 'exceptZero', minimumFractionDigits: 1, maximumFractionDigits: 1 });

const usable = (value: number | null | undefined): value is number => value !== null && value !== undefined && Number.isFinite(value);

export const formatCount = (value: number | null | undefined): string => usable(value) ? count.format(value) : DASH;
export const formatPercent = (value: number | null | undefined): string => usable(value) ? percent.format(value) : DASH;
export const formatSeconds = (value: number | null | undefined): string => !usable(value) ? DASH : value < 1 ? millis.format(value * 1000) : seconds.format(value);
export const formatUsd = (value: number | null | undefined): string => usable(value) ? usd.format(value) : DASH;

const formatters: Record<Unit, (value: number | null | undefined) => string> = { count: formatCount, percent: formatPercent, seconds: formatSeconds, usd: formatUsd };
export const formatValue = (unit: Unit, value: number | null | undefined): string => formatters[unit](value);

export function delta(current: number | null | undefined, previous: number | null | undefined): Delta {
  if (!usable(current) || !usable(previous) || previous === 0) return { text: DASH, direction: 'none' };
  const change = (current - previous) / previous;
  const text = signedPercent.format(change);
  return { text, direction: text.startsWith('+') ? 'up' : text.startsWith('-') || text.startsWith('−') ? 'down' : 'flat' };
}

const successRate = (totals: { runs: number; completed: number }): number | null => totals.runs === 0 ? null : totals.completed / totals.runs;

export function kpis(total: Kpis): KpiTile[] {
  const tile = (id: string, label: string, unit: Unit, value: number | null, previous: number | null, goodWhenUp = true): KpiTile => ({ id, label, unit, value, previous, change: delta(value, previous), goodWhenUp });
  return [
    tile('runs', 'Runs', 'count', total.runs, total.previous.runs),
    tile('success', 'Success rate', 'percent', successRate(total), successRate(total.previous)),
    tile('p95', 'p95 run duration', 'seconds', total.p95Seconds, total.previous.p95Seconds, false),
    tile('spend', 'Model spend', 'usd', total.cost, total.previous.cost, false),
    tile('pending', 'Pending approvals', 'count', total.pendingApprovals, null, false),
  ];
}

export const successRateOf = successRate;

const telemetryText: Record<SeriesStatus, string> = { ready: 'Telemetry connected', 'not-configured': 'Telemetry not configured', unavailable: 'Telemetry unavailable' };

export function banner(health: Health | undefined, telemetry: SeriesStatus | undefined): { text: string; tone: 'ok' | 'warn' } {
  const parts = [telemetry === undefined ? 'Telemetry status unknown' : telemetryText[telemetry]];
  const open = health?.circuits.filter((circuit) => circuit.state === 'open').length ?? 0;
  const reconcile = health?.reconciliation.length ?? 0;
  parts.push(`${formatCount(open)} open ${open === 1 ? 'circuit' : 'circuits'}`, `${formatCount(reconcile)} ${reconcile === 1 ? 'run needs' : 'runs need'} reconciliation`);
  return { text: parts.join(' · '), tone: telemetry === 'ready' && open === 0 && reconcile === 0 ? 'ok' : 'warn' };
}

export function scopeQuery(scope: string | undefined, range: RangeKey): Record<string, string> {
  return scope === undefined ? { range } : { range, tenant: scope };
}

export function dataNotes(...collections: readonly ({ completeness: Completeness; classification: Classification } | undefined)[]): string[] {
  const loaded = collections.filter((item) => item !== undefined);
  return [
    ...loaded.some((item) => item.classification === 'fixture') ? ['Fixture data: these numbers are examples, not your real activity.'] : [],
    ...loaded.some((item) => item.completeness === 'partial') ? ['Partial data: some runs are estimated or retained only in part.'] : [],
  ];
}

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;

export function timeLeft(expiresAt: string, now: number): { text: string; expired: boolean } {
  const remaining = Date.parse(expiresAt) - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return { text: 'Expired', expired: true };
  if (remaining < MS_PER_MINUTE) return { text: 'under a minute', expired: false };
  const minutes = Math.floor(remaining / MS_PER_MINUTE);
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  return { text: hours === 0 ? `${String(rest)} min` : rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`, expired: false };
}

export function approvalCommand(row: Approval, decision: 'approve' | 'reject'): PlatformCommand {
  return { tenantId: row.tenantId, owner: 'workflow', name: 'approve', expectedVersion: row.runVersion, arguments: { id: row.runId, bindingDigest: row.bindingDigest, decision } };
}

export type DecisionFailure = 'conflict' | 'denied' | 'unknown' | 'failed';

export function decisionFailure(error: unknown): DecisionFailure {
  const kind = describeError(error, { write: true });
  return kind === 'conflict' || kind === 'denied' || kind === 'unknown' ? kind : 'failed';
}

const SHORT_ID_LENGTH = 8;
export const MAX_GROUP_WORKSPACES = 50;
export const MAX_GROUP_ADMINS = 20;
export const shortId = (id: string): string => id.slice(0, SHORT_ID_LENGTH);

export const addableWorkspaces = (tenants: readonly Tenant[], group: Group): string[] =>
  tenants.filter((tenant) => tenant.profiles.includes('admin') && !group.tenantIds.includes(tenant.id)).map((tenant) => tenant.id);

const CONSENT_COMMANDS: readonly GroupCommandName[] = ['add-tenant', 'create-group'];

export function commandFailure(error: unknown, name: GroupCommandName, adminCount = MAX_GROUP_ADMINS): string {
  const status = error instanceof PlatformApiError ? error.status : undefined;
  if (status === 409 && name === 'remove-admin' && adminCount <= 1) return 'A group must keep at least one admin.';
  if (status === 409) return 'The group changed since you loaded it. It has been reloaded.';
  if (status === 403) return CONSENT_COMMANDS.includes(name) ? "Only a workspace's own admin can add it to a group." : "You can't change this group.";
  if (status === 422 || status === 400) return 'That request was not valid.';
  return 'The change could not be saved. Try again.';
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

export interface LogFilters { range: RangeKey; scope: string | undefined; level: string; event: string; run: string; cursor: string | undefined }

export function logsQuery({ range, scope, level, event, run, cursor }: LogFilters): Record<string, string> {
  return { ...scopeQuery(scope, range), ...level === '' ? {} : { level }, ...event === '' ? {} : { event }, ...run === '' ? {} : { run }, ...cursor === undefined ? {} : { cursor } };
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

export function formatDuration(ms: number): string {
  if (ms < MS_PER_SECOND) return `${String(Math.round(ms))} ms`;
  const seconds = ms / MS_PER_SECOND;
  if (seconds < SECONDS_PER_MINUTE) return `${String(Math.round(seconds * 10) / 10)} s`;
  const whole = Math.round(seconds);
  const rest = whole % SECONDS_PER_MINUTE;
  return `${String(Math.floor(whole / SECONDS_PER_MINUTE))} min${rest === 0 ? '' : ` ${String(rest)} s`}`;
}

const MIN_WIDTH_PERCENT = 0.5;
const PERCENT = 100;
const hundredths = (value: number): number => Math.round(value * PERCENT) / PERCENT;
export interface WaterfallRow { span: Span; offsetPercent: number; widthPercent: number; depth: number }

export function waterfall(spans: readonly Span[]): { totalMs: number; rows: WaterfallRow[] } {
  if (spans.length === 0) return { totalMs: 0, rows: [] };
  const origin = Math.min(...spans.map((span) => span.startMs));
  const totalMs = Math.max(...spans.map((span) => span.startMs + span.durationMs)) - origin;
  const byId = new Map(spans.map((span) => [`${span.traceId}:${span.spanId}`, span]));
  const depthOf = (span: Span): number => {
    const seen = new Set<Span>([span]);
    let depth = 0;
    for (let parent = span.parentSpanId === undefined ? undefined : byId.get(`${span.traceId}:${span.parentSpanId}`); parent !== undefined && !seen.has(parent); parent = parent.parentSpanId === undefined ? undefined : byId.get(`${parent.traceId}:${parent.parentSpanId}`)) { seen.add(parent); depth += 1; }
    return depth;
  };
  const rows = [...spans].sort((a, b) => a.startMs - b.startMs).map((span): WaterfallRow => {
    const width = totalMs === 0 ? MIN_WIDTH_PERCENT : Math.max(MIN_WIDTH_PERCENT, hundredths(span.durationMs / totalMs * PERCENT));
    const offset = totalMs === 0 ? 0 : Math.min(hundredths((span.startMs - origin) / totalMs * PERCENT), PERCENT - MIN_WIDTH_PERCENT);
    return { span, offsetPercent: offset, widthPercent: Math.min(width, PERCENT - offset), depth: depthOf(span) };
  });
  return { totalMs, rows };
}

const MAX_SENT_MESSAGES = 12;

export function messagesToSend(messages: readonly ChatMessage[]): ChatMessage[] {
  const recent = messages.slice(-MAX_SENT_MESSAGES);
  const first = recent.findIndex((message) => message.role === 'user');
  return first < 0 ? [] : recent.slice(first);
}
