import { AppError } from '../../errors/src/app-error.js';
import type { GroupContext } from '../../identity/src/index.js';
import { isPanel, isRange, isSqlPanel, RANGES, type RangeKey } from './catalog.js';
import { buildApprovals, buildHealth } from './attention.js';
import { fixtureApprovals, fixtureHealth, fixtureMembers, fixtureOverview, fixtureSeries, fixtureWorkflows } from './fixtures.js';
import { buildOverview, buildSeries, buildWorkflows } from './reads.js';
import type { AzureSqlGovernanceStore } from './sql.js';

export type GovernanceStore = Pick<AzureSqlGovernanceStore, 'members' | 'overview' | 'runSeries' | 'workflows' | 'pendingApprovals' | 'health'>;
type Query = Readonly<Record<string, string>>;
interface Window { range: RangeKey; from: number; to: number; tenantId?: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEYS = { members: [], approvals: ['range', 'tenant'], health: ['range', 'tenant'], overview: ['range', 'tenant'], series: ['panel', 'range', 'tenant'], workflows: ['range', 'tenant'] } as const;
type Collection = keyof typeof KEYS;
const isCollection = (value: string): value is Collection => Object.hasOwn(KEYS, value);

export class GovernanceService {
  constructor(private readonly store?: GovernanceStore, private readonly now: () => number = Date.now) {}

  async read(context: GroupContext, collection: string, query: Query): Promise<Record<string, unknown>> {
    if (!isCollection(collection)) throw new AppError('NOT_FOUND');
    if (Object.keys(query).some((key) => !(KEYS[collection] as readonly string[]).includes(key))) throw new AppError('INVALID');
    if (collection === 'members') return this.members(context);
    if (collection === 'approvals') return this.approvals(context);
    if (collection === 'health') return this.health(context);
    const window = this.window(context, query);
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
    if (!isSqlPanel(panel)) return { panel, range: window.range, status: 'not-configured', series: [], completeness: 'full', classification: this.classification() };
    const rows = this.store === undefined ? fixtureSeries(this.scope(context, window), window.range, window.from) : await this.store.runSeries(context, new Date(window.from), new Date(window.to), RANGES[window.range].bucketMinutes, window.tenantId);
    return { ...buildSeries(panel, window.range, rows, window.from), classification: this.classification() };
  }

  private classification(): 'fixture' | 'restricted-operational' {
    return this.store === undefined ? 'fixture' : 'restricted-operational';
  }
}
