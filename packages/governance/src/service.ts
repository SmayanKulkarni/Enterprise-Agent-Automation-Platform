import { EVENTS } from '../../telemetry/src/events.js';
import { AppError } from '../../errors/src/app-error.js';
import type { GroupContext } from '../../identity/src/index.js';
import { NONE, type Backends } from './backend.js';
import { isPanel, isPrometheusPanel, isRange, isSqlPanel, PROMETHEUS_PANELS, RANGES, type PrometheusPanelId, type RangeKey } from './catalog.js';
import { buildApprovals, buildHealth } from './attention.js';
import { fixtureApprovals, fixtureHealth, fixtureMembers, fixtureOverview, fixtureSeries, fixtureWorkflows } from './fixtures.js';
import { buildOverview, buildSeries, buildWorkflows } from './reads.js';
import { decodeLogCursor, encodeLogCursor, lokiLogs, lokiQuery, LEVELS } from './loki.js';
import { prometheusRange } from './prometheus.js';
import { tenantMatcher, tenantPattern, UUID } from './scope.js';
import { tempoTrace } from './tempo.js';
import type { AzureSqlGovernanceStore } from './sql.js';

export type GovernanceStore = Pick<AzureSqlGovernanceStore, 'members' | 'overview' | 'runSeries' | 'workflows' | 'pendingApprovals' | 'health'>;
type Query = Readonly<Record<string, string>>;
interface Window { range: RangeKey; from: number; to: number; tenantId?: string }

const LOG_PAGE = 200;
const NS_PER_MS = 1_000_000n;
const KEYS = { members: [], approvals: ['range', 'tenant'], health: ['range', 'tenant'], overview: ['range', 'tenant'], series: ['panel', 'range', 'tenant'], workflows: ['range', 'tenant'], logs: ['range', 'tenant', 'level', 'event', 'run', 'cursor'], trace: ['run'] } as const;
type Collection = keyof typeof KEYS;
const isCollection = (value: string): value is Collection => Object.hasOwn(KEYS, value);

export class GovernanceService {
  constructor(private readonly store?: GovernanceStore, private readonly now: () => number = Date.now, private readonly backends: Backends = NONE) {}

  async read(context: GroupContext, collection: string, query: Query): Promise<Record<string, unknown>> {
    if (!isCollection(collection)) throw new AppError('NOT_FOUND');
    if (Object.keys(query).some((key) => !(KEYS[collection] as readonly string[]).includes(key))) throw new AppError('INVALID');
    if (collection === 'members') return this.members(context);
    if (collection === 'approvals') return this.approvals(context);
    if (collection === 'health') return this.health(context);
    if (collection === 'trace') return this.trace(context, query['run']);
    const window = this.window(context, query);
    if (collection === 'logs') return this.logs(context, window, query);
    if (collection === 'overview') return this.overview(context, window);
    if (collection === 'workflows') return this.workflows(context, window);
    return this.series(context, window, query['panel']);
  }

  private async members(context: GroupContext): Promise<Record<string, unknown>> {
    if (this.store === undefined) return { ...fixtureMembers(context), completeness: 'full', classification: 'fixture' };
    return { ...await this.store.members(context), completeness: 'full', classification: 'restricted-operational' };
  }

  private async approvals(context: GroupContext): Promise<Record<string, unknown>> {
    const rows = this.store === undefined ? fixtureApprovals(context.tenantIds.map(String), this.now()) : await this.store.pendingApprovals(context);
    return { ...buildApprovals(rows), classification: this.classification() };
  }

  private async health(context: GroupContext): Promise<Record<string, unknown>> {
    const rows = this.store === undefined ? fixtureHealth(context.tenantIds.map(String), this.now()) : await this.store.health(context);
    return { ...buildHealth(rows), classification: this.classification() };
  }

  private window(context: GroupContext, query: Query): Window {
    const range = query['range'];
    if (range === undefined || !isRange(range)) throw new AppError('INVALID');
    const tenant = query['tenant'];
    if (tenant === undefined) return { range, ...this.bounds(range) };
    if (!UUID.test(tenant)) throw new AppError('INVALID');
    const tenantId = tenant.toLowerCase();
    if (!context.tenantIds.some((member) => String(member).toLowerCase() === tenantId)) throw new AppError('DENIED');
    return { range, ...this.bounds(range), tenantId };
  }

  private bounds(range: RangeKey): { from: number; to: number } {
    const to = this.now();
    return { from: to - RANGES[range].ms, to };
  }

  private scope(context: GroupContext, window: Window): string[] {
    return context.tenantIds.map(String).filter((id) => window.tenantId === undefined || id.toLowerCase() === window.tenantId);
  }

  private async overview(context: GroupContext, window: Window): Promise<Record<string, unknown>> {
    const rows = this.store === undefined ? fixtureOverview(this.scope(context, window)) : await this.store.overview(context, new Date(window.from), new Date(window.to), window.tenantId);
    return { ...buildOverview(rows, window.range), classification: this.classification() };
  }

  private async workflows(context: GroupContext, window: Window): Promise<Record<string, unknown>> {
    const rows = this.store === undefined ? fixtureWorkflows(this.scope(context, window)) : await this.store.workflows(context, new Date(window.from), new Date(window.to), window.tenantId);
    return { ...buildWorkflows(rows, window.range), classification: this.classification() };
  }

  private async series(context: GroupContext, window: Window, panel: string | undefined): Promise<Record<string, unknown>> {
    if (panel === undefined || !isPanel(panel)) throw new AppError('INVALID');
    if (isPrometheusPanel(panel)) return this.telemetrySeries(context, window, panel);
    if (!isSqlPanel(panel)) return { panel, range: window.range, status: 'not-configured', series: [], completeness: 'full', classification: this.classification() };
    const rows = this.store === undefined ? fixtureSeries(this.scope(context, window), window.range, window.from) : await this.store.runSeries(context, new Date(window.from), new Date(window.to), RANGES[window.range].bucketMinutes, window.tenantId);
    return { ...buildSeries(panel, window.range, rows, window.from), classification: this.classification() };
  }

  private async telemetrySeries(context: GroupContext, window: Window, panel: PrometheusPanelId): Promise<Record<string, unknown>> {
    const base = { panel, range: window.range, completeness: window.range === '30d' ? 'partial' : 'full', classification: this.classification() };
    const ids = this.scope(context, window);
    if (ids.length === 0) return { ...base, status: 'ready', series: [] };
    const step = RANGES[window.range].bucketMinutes * 60;
    const queries = PROMETHEUS_PANELS[panel](tenantMatcher(ids), step, RANGES[window.range].ms / 1000);
    return { ...base, ...await prometheusRange(this.backends.prometheus, queries, window.from, window.to, step) };
  }

  private async logs(context: GroupContext, window: Window, query: Query): Promise<Record<string, unknown>> {
    const { level, event, run, cursor } = query;
    if (level !== undefined && !(LEVELS as readonly string[]).includes(level)) throw new AppError('INVALID');
    if (event !== undefined && !Object.hasOwn(EVENTS, event)) throw new AppError('INVALID');
    if (run !== undefined && !UUID.test(run)) throw new AppError('INVALID');
    const before = cursor === undefined ? undefined : decodeLogCursor(cursor, context.groupId);
    const base = { range: window.range, completeness: window.range === '30d' ? 'partial' : 'full', classification: this.classification() };
    const ids = this.scope(context, window);
    if (ids.length === 0) return { ...base, status: 'ready', entries: [] };
    const toNs = before === undefined ? BigInt(window.to) * NS_PER_MS : before - 1n;
    const result = await lokiLogs(this.backends.loki, lokiQuery(tenantPattern(ids), { ...(level === undefined ? {} : { level }), ...(event === undefined ? {} : { event }), ...(run === undefined ? {} : { run }) }), BigInt(window.from) * NS_PER_MS, toNs, LOG_PAGE + 1);
    const page = result.entries.slice(0, LOG_PAGE);
    const last = page[LOG_PAGE - 1];
    return { ...base, status: result.status, entries: page.map(({ at, event: name, level: severity, attributes }) => ({ at, event: name, level: severity, attributes })), ...(result.entries.length > LOG_PAGE && last !== undefined ? { continuation: { cursor: encodeLogCursor(context.groupId, last.ns) } } : {}) };
  }

  private async trace(context: GroupContext, run: string | undefined): Promise<Record<string, unknown>> {
    if (run === undefined || !UUID.test(run)) throw new AppError('INVALID');
    const base = { run: run.toLowerCase(), completeness: 'full', classification: this.classification() };
    const ids = context.tenantIds.map(String);
    if (ids.length === 0) return { ...base, status: 'ready', spans: [] };
    return { ...base, ...await tempoTrace(this.backends.tempo, run.toLowerCase(), tenantPattern(ids), ids) };
  }

  private classification(): 'fixture' | 'restricted-operational' {
    return this.store === undefined ? 'fixture' : 'restricted-operational';
  }
}
