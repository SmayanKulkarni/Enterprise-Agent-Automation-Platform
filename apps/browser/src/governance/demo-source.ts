import { RANGES, isPanel, isSqlPanel } from '../../../../packages/governance/src/catalog.js';
import { DEMO_DEFINITION_ID, DEMO_GITHUB_INSTALLATION_ID, DEMO_TENANT_ID, type DemoRun } from '../../../../packages/workflow/src/pr-gate-demo.js';
import { decodeLogs, decodeOverview, decodeSeries, decodeTrace, decodeWorkflows, type Approval, type Group, type Kpis, type LogEntry, type Logs, type Overview, type RangeKey, type Series, type Span, type Totals, type Trace, type Workflows } from './decoders.js';
import type { GovernanceSource } from './governance-source.js';

export interface DemoRemote {
  read<T>(collection: string, query: Readonly<Record<string, string>>, decode: (value: unknown) => T, signal: AbortSignal): Promise<T>;
}

export const DEMO_GROUP: Group = { id: 'demo-group', name: 'Demo group', epoch: 1, adminEpoch: 1, tenantIds: [DEMO_TENANT_ID] };
const WORKSPACE = 'Demo workspace';
const WORKFLOW = 'PR gate';
const APPROVAL_WINDOW_MS = 86_400_000;
const CLASSIFICATION = 'restricted-operational' as const;

const ZERO: Totals = { runs: 0, completed: 0, failed: 0, unknownOutcome: 0, p95Seconds: null, tokens: 0, cost: 0 };
const hex = (value: string, length: number): string => value.replaceAll('-', '').repeat(Math.ceil(length / 32)).slice(0, length);
const aborted = <T>(signal: AbortSignal, build: () => T): Promise<T> => signal.aborted ? Promise.reject(new DOMException('Aborted', 'AbortError')) : Promise.resolve(build());
const runLabel = (run: DemoRun): string => `${run.pullRequest.owner}/${run.pullRequest.repo}#${String(run.pullRequest.pullNumber)} ${run.pullRequest.title}`;
const capabilityOf = (run: DemoRun): string => run.branch === 'accept' ? 'merge_pull_request' : 'issue_write';

export function demoApproval(run: DemoRun): Approval {
  const findings = run.verdict.findings.map((finding) => `${finding.file}:${String(finding.line)} - ${finding.problem} - ${finding.fix}`);
  return {
    tenantId: DEMO_TENANT_ID, workspace: WORKSPACE, runId: run.id, runVersion: run.steps.length, workflowName: WORKFLOW, runLabel: runLabel(run), revision: 1, nodeId: run.waitingNodeId, kind: 'step',
    capability: capabilityOf(run), installationId: DEMO_GITHUB_INSTALLATION_ID, target: 'github.com',
    arguments: [{ name: 'owner', type: 'string' }, { name: 'repo', type: 'string' }, { name: run.branch === 'accept' ? 'pullNumber' : 'title', type: run.branch === 'accept' ? 'number' : 'string' }],
    facts: [{ name: 'Reviewer suggestion', value: `${run.branch === 'accept' ? 'Accept' : 'Return'} (${run.verdict.riskLevel} risk). ${run.verdict.summary}` }, ...(findings.length === 0 ? [] : [{ name: 'Findings', value: findings.join('\n') }])],
    argumentsDigest: hex(run.id, 64), bindingDigest: hex(run.id.split('').reverse().join(''), 64), requestedAt: run.startedAt, expiresAt: new Date(Date.parse(run.startedAt) + APPROVAL_WINDOW_MS).toISOString(),
  };
}

function logEntries(run: DemoRun): LogEntry[] {
  const started = Date.parse(run.startedAt);
  const at = (offset: number): string => new Date(started + offset).toISOString();
  const base = { tenant_id: DEMO_TENANT_ID, run_id: run.id };
  const reads = run.steps.filter((step) => step.kind === 'mcp');
  return [
    { at: at(0), event: 'run.started', level: 'info', attributes: { ...base, definition_id: DEMO_DEFINITION_ID, trigger: 'manual', owner_id: 'demo-visitor' } },
    ...reads.map((step): LogEntry => ({ at: at(step.startMs), event: 'mcp.call', level: 'info', attributes: { ...base, node_id: step.nodeId, capability: 'pull_request_read', route: 'demo', outcome: 'ok', duration_s: step.durationMs / 1000 } })),
    { at: at(run.steps.at(-1)?.startMs ?? 0), event: 'approval.requested', level: 'info', attributes: { ...base, node_id: run.waitingNodeId, kind: 'step', capability: capabilityOf(run), expires_at: new Date(started + APPROVAL_WINDOW_MS).toISOString() } },
    { at: at(0), event: 'demo.run', level: 'info', attributes: { source: run.source, outcome: run.outcome, branch: run.branch } },
  ].sort((left, right) => Date.parse(right.at) - Date.parse(left.at)) as LogEntry[];
}

function spans(run: DemoRun): Span[] {
  const traceId = hex(run.id, 32);
  const started = Date.parse(run.startedAt);
  const total = run.steps.reduce((sum, step) => sum + step.durationMs, 0);
  const root: Span = { traceId, spanId: hex(run.id, 16), name: 'workflow.run', startMs: started, durationMs: total, status: 'unset', attributes: { tenant_id: DEMO_TENANT_ID, run_id: run.id, source: run.source } };
  return [root, ...run.steps.map((step, index): Span => ({
    traceId, spanId: hex(`${String(index + 1).padStart(8, '0')}${run.id}`, 16), parentSpanId: root.spanId, name: `${step.kind}.${step.nodeId}`, startMs: started + step.startMs, durationMs: step.durationMs,
    status: step.state === 'waiting' ? 'unset' : 'ok', attributes: { node_id: step.nodeId, node_kind: step.kind, state: step.state },
  }))];
}

const preferred = async <T>(remote: DemoRemote | undefined, collection: string, query: Readonly<Record<string, string>>, decode: (value: unknown) => T, signal: AbortSignal, usable: (value: T) => boolean): Promise<T | undefined> => {
  if (remote === undefined) return undefined;
  try {
    const value = await remote.read(collection, query, decode, signal);
    return usable(value) ? value : undefined;
  } catch (error) {
    if (signal.aborted) throw error;
    return undefined;
  }
};

export function demoSource(run: DemoRun | undefined, now: () => number = Date.now, remote?: DemoRemote): GovernanceSource {
  const inRange = (range: RangeKey): boolean => run !== undefined && now() - Date.parse(run.startedAt) <= RANGES[range].ms;
  const pending = run === undefined ? 0 : 1;
  const kpis = (range: RangeKey): Kpis => ({ ...ZERO, runs: inRange(range) ? 1 : 0, pendingApprovals: pending, previous: ZERO });
  const localOverview = (range: RangeKey, signal: AbortSignal): Promise<Overview> => aborted(signal, () => ({ range, total: kpis(range), workspaces: [{ ...kpis(range), tenantId: DEMO_TENANT_ID, name: WORKSPACE }], completeness: 'full', classification: CLASSIFICATION }));
  const localWorkflows = (range: RangeKey, signal: AbortSignal): Promise<Workflows> => aborted(signal, () => ({ range, workflows: [{ tenantId: DEMO_TENANT_ID, workspace: WORKSPACE, definitionId: DEMO_DEFINITION_ID, name: WORKFLOW, runs: inRange(range) ? 1 : 0, successRate: null, p95Seconds: null, cost: 0 }], completeness: 'full', classification: CLASSIFICATION }));
  const localLogs = (query: Readonly<Record<string, string>>, signal: AbortSignal): Promise<Logs> => aborted(signal, () => {
    const entries = run === undefined ? [] : logEntries(run).filter((entry) => (query['level'] === undefined || entry.level === query['level']) && (query['event'] === undefined || entry.event === query['event']) && (query['run'] === undefined || entry.attributes['run_id'] === query['run']));
    return { range: (query['range'] ?? '7d') as RangeKey, status: 'ready', entries, completeness: 'full', classification: CLASSIFICATION };
  });
  const localTrace = (runId: string, signal: AbortSignal): Promise<Trace> => aborted(signal, () => ({ run: runId, status: 'ready', spans: run !== undefined && run.id === runId ? spans(run) : [], completeness: 'full', classification: CLASSIFICATION }));
  const localSeries = (panel: string, range: RangeKey, signal: AbortSignal): Promise<Series> => aborted(signal, () => ({ panel, range, status: isPanel(panel) && isSqlPanel(panel) ? 'ready' : 'not-configured', series: [], completeness: 'full', classification: CLASSIFICATION }));
  return {
    fixture: true,
    demo: true,
    overview: async (range, _scope, signal) => {
      const served = await preferred(remote, 'overview', { range }, decodeOverview, signal, () => true);
      return served === undefined ? localOverview(range, signal) : { ...served, total: { ...served.total, pendingApprovals: pending }, workspaces: served.workspaces.map((workspace) => ({ ...workspace, pendingApprovals: pending })) };
    },
    workflows: async (range, _scope, signal) => (await preferred(remote, 'workflows', { range }, decodeWorkflows, signal, () => true)) ?? localWorkflows(range, signal),
    health: (signal) => aborted(signal, () => ({ connectors: [{ tenantId: DEMO_TENANT_ID, workspace: WORKSPACE, healthy: 2, offline: 0, revoked: 0 }], circuits: [], reconciliation: [], completeness: 'full', classification: CLASSIFICATION })),
    approvals: (signal) => aborted(signal, () => ({ approvals: run === undefined ? [] : [demoApproval(run)], count: run === undefined ? 0 : 1, completeness: 'full', classification: CLASSIFICATION })),
    members: (signal) => aborted(signal, () => ({ workspaces: [{ tenantId: DEMO_TENANT_ID, name: WORKSPACE, joinedAt: run?.startedAt ?? new Date(now()).toISOString(), billing: false }], admins: [{ userId: 'demo-visitor', name: 'You (demo)' }], eligible: [] })),
    logs: async (query, signal) => (await preferred(remote, 'logs', query, decodeLogs, signal, (value) => value.status === 'ready' && value.entries.length > 0)) ?? localLogs(query, signal),
    trace: async (runId, signal) => (await preferred(remote, 'trace', { run: runId }, decodeTrace, signal, (value) => value.status === 'ready' && value.spans.length > 0)) ?? localTrace(runId, signal),
    series: async (panel, range, _scope, signal) => (await preferred(remote, 'series', { panel, range }, decodeSeries, signal, () => true)) ?? localSeries(panel, range, signal),
  };
}
