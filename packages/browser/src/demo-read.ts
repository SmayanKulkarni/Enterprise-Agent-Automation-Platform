import { AppError } from '../../errors/src/app-error.js';
import { reported } from '../../errors/src/swallow.js';
import { isRange, RANGES, type RangeKey } from '../../governance/src/catalog.js';
import { buildOverview, buildSeries, buildWorkflows, windowSpan, type WindowRow } from '../../governance/src/reads.js';
import type { GovernanceService } from '../../governance/src/service.js';
import type { GroupContext } from '../../identity/src/index.js';
import { tenantId } from '../../contracts/src/index.js';
import { DEMO_DEFINITION_ID, DEMO_TENANT_ID, type DemoRun } from '../../workflow/src/pr-gate-demo.js';
import { claimKey } from './demo-run.js';

const MAX_QUERY_CHARS = 512;
const WORKSPACE = 'Demo workspace';
const WORKFLOW = 'PR gate';
const CLASSIFICATION = 'fixture';
const OWN_QUERY_KEYS: Readonly<Record<string, readonly string[]>> = { run: [], overview: ['range'], workflows: ['range'], series: ['panel', 'range'], logs: ['range', 'level', 'event', 'run', 'cursor'], trace: ['run'] };
const CONTEXT: GroupContext = { userId: 'demo-visitor', groupId: 'demo-group', groupEpoch: 1, adminEpoch: 1, tenantIds: [tenantId(DEMO_TENANT_ID)] };

export interface DemoSummary { buckets: readonly { start: Date; runs: number }[]; current: number; previous: number }
export interface DemoReadDeps {
  own(key: string): Promise<DemoRun | undefined>;
  summary(from: Date, to: Date, bucketMinutes: number): Promise<DemoSummary>;
  governance: Pick<GovernanceService, 'read'>;
  allow(key: string): boolean;
  now(): number;
  pepper: string;
}
export interface DemoReadRequest { ip: string | undefined; target: string; query: Readonly<Record<string, string>> }
export interface DemoReadReply { status: number; body: unknown }

const fail = (status: number, code: string, message: string): DemoReadReply => ({ status, body: { error: { code, message } } });
const invalid = (): DemoReadReply => fail(400, 'INVALID_INPUT', 'The request is not valid.');
const unavailable = (): DemoReadReply => fail(503, 'DEMO_UNAVAILABLE', 'The demo is temporarily unavailable.');

const windowRow = (window: WindowRow['window'], runs: number): WindowRow => ({ window, runs, completed: 0, failed: 0, unknownOutcome: 0, p95Ms: null, tokens: 0, cost: 0, estimatedRuns: 0 });

function runsOverTime(summary: DemoSummary, range: RangeKey, from: number): unknown {
  const { step, points } = windowSpan(range);
  const grid = new Array<number>(points).fill(0);
  for (const bucket of summary.buckets) {
    const index = Math.floor((bucket.start.getTime() - from) / step);
    if (index >= 0 && index < points) grid[index] = (grid[index] ?? 0) + bucket.runs;
  }
  return { panel: 'runs-over-time', range, status: 'ready', series: [{ label: 'demo runs', points: grid.map((value, index) => [from + index * step, value]) }], completeness: 'full', classification: CLASSIFICATION };
}

async function read(request: DemoReadRequest, range: RangeKey, deps: DemoReadDeps): Promise<DemoReadReply> {
  const to = deps.now();
  const from = to - RANGES[range].ms;
  const panel = request.query['panel'];
  if (request.target === 'series' && panel !== 'runs-over-time' && panel !== 'spend-by-workspace') return { status: 200, body: await deps.governance.read(CONTEXT, 'series', request.query) };
  if (request.target === 'series' && panel === 'spend-by-workspace') return { status: 200, body: { ...buildSeries('spend-by-workspace', range, [], from), classification: CLASSIFICATION } };
  const summary = await deps.summary(new Date(from), new Date(to), RANGES[range].bucketMinutes);
  if (request.target === 'series') return { status: 200, body: runsOverTime(summary, range, from) };
  if (request.target === 'workflows') return { status: 200, body: { ...buildWorkflows([{ tenantId: DEMO_TENANT_ID, workspace: WORKSPACE, definitionId: DEMO_DEFINITION_ID, name: WORKFLOW, runs: summary.current, completed: 0, p95Ms: null, cost: 0, estimatedRuns: 0 }], range), classification: CLASSIFICATION } };
  const rows = [windowRow('current', summary.current), windowRow('previous', summary.previous)];
  return { status: 200, body: { ...buildOverview({ workspaces: rows.map((row) => ({ ...row, tenantId: DEMO_TENANT_ID, name: WORKSPACE })), totals: rows, pending: [] }, range), classification: CLASSIFICATION } };
}

export async function handleDemoRead(request: DemoReadRequest, deps: DemoReadDeps): Promise<DemoReadReply> {
  if (request.ip === undefined) return unavailable();
  const key = claimKey(request.ip, deps.pepper);
  if (!deps.allow(key)) return fail(429, 'RATE_LIMITED', 'Too many demo requests. Try again in a minute.');
  const allowed = OWN_QUERY_KEYS[request.target];
  if (allowed === undefined || Object.keys(request.query).some((name) => !allowed.includes(name)) || Object.values(request.query).some((value) => value.length > MAX_QUERY_CHARS)) return invalid();
  try {
    if (request.target === 'run') {
      const run = await deps.own(key);
      return run === undefined ? fail(404, 'NOT_FOUND', 'No demo run was found for this address.') : { status: 200, body: { run } };
    }
    if (request.target === 'logs' || request.target === 'trace') {
      if (request.target === 'logs' && !isRange(request.query['range'] ?? '')) return invalid();
      return { status: 200, body: await deps.governance.read(CONTEXT, request.target, request.query) };
    }
    const range = request.query['range'] ?? '';
    return isRange(range) && (request.target !== 'series' || request.query['panel'] !== undefined) ? await read(request, range, deps) : invalid();
  } catch (error) {
    if (error instanceof AppError && (error.code === 'INVALID' || error.code === 'NOT_FOUND')) return invalid();
    return reported(unavailable(), 'demo.read')(error);
  }
}
