import { expect, test } from 'vitest';
import { SAMPLE_DIFF, SAMPLE_PULL_REQUEST, runDemo } from '../../../../packages/workflow/src/pr-gate-demo.js';
import { DEMO_GROUP, demoSource, type DemoRemote } from './demo-source.js';
import { decodeApprovals, decodeHealth, decodeLogs, decodeOverview, decodeTrace, decodeWorkflows } from './decoders.js';

const START = Date.parse('2026-10-07T10:00:00.000Z');
const run = runDemo({ id: 'e0000000-0000-4000-8000-000000000001', now: START, pullRequest: SAMPLE_PULL_REQUEST, diff: SAMPLE_DIFF, source: 'sample' });
const signal = new AbortController().signal;
const at = (offsetMs: number) => () => START + offsetMs;

test('before a run the demo workspace is empty and every read is valid', async () => {
  const source = demoSource(undefined, at(0));
  const overview = decodeOverview(await source.overview('7d', undefined, signal));
  expect(overview.total).toMatchObject({ runs: 0, pendingApprovals: 0 });
  expect(decodeWorkflows(await source.workflows('7d', undefined, signal)).workflows).toMatchObject([{ name: 'PR gate', runs: 0, successRate: null }]);
  expect((await source.approvals(signal)).count).toBe(0);
  expect(decodeLogs(await source.logs({ range: '7d' }, signal)).entries).toEqual([]);
});

test('after a run the overview, workflow, approval, logs and trace all show it', async () => {
  const source = demoSource(run, at(60_000));
  expect(source).toMatchObject({ fixture: true, demo: true });
  expect(decodeOverview(await source.overview('24h', undefined, signal)).total).toMatchObject({ runs: 1, pendingApprovals: 1, cost: 0, tokens: 0 });
  expect(decodeWorkflows(await source.workflows('24h', undefined, signal)).workflows[0]).toMatchObject({ runs: 1, cost: 0 });
  const approvals = decodeApprovals(await source.approvals(signal));
  expect(approvals.approvals).toHaveLength(1);
  expect(approvals.approvals[0]).toMatchObject({ runId: run.id, nodeId: 'approve_issue', capability: 'issue_write' });
  expect(approvals.approvals[0]?.facts.map((fact) => fact.name)).toEqual(['Reviewer suggestion', 'Findings']);
  const logs = decodeLogs(await source.logs({ range: '24h' }, signal));
  expect(logs.entries.map((entry) => entry.event).sort()).toEqual(['approval.requested', 'demo.run', 'mcp.call', 'run.started']);
  expect(decodeLogs(await source.logs({ range: '24h', event: 'mcp.call' }, signal)).entries).toHaveLength(1);
  expect(decodeLogs(await source.logs({ range: '24h', run: 'f0000000-0000-4000-8000-000000000009' }, signal)).entries).toEqual([]);
  const trace = decodeTrace(await source.trace(run.id, signal));
  expect(trace.spans).toHaveLength(run.steps.length + 1);
  expect(decodeTrace(await source.trace('f0000000-0000-4000-8000-000000000009', signal)).spans).toEqual([]);
  expect(decodeHealth(await source.health(signal)).connectors).toHaveLength(1);
});

test('a run older than the selected range is not counted in it but is still pending', async () => {
  const source = demoSource(run, at(2 * 3_600_000));
  expect(decodeOverview(await source.overview('1h', undefined, signal)).total).toMatchObject({ runs: 0, pendingApprovals: 1 });
  expect(decodeOverview(await source.overview('24h', undefined, signal)).total).toMatchObject({ runs: 1 });
});

test('the demo group has one workspace and the assistant-free fixture flag', async () => {
  expect(DEMO_GROUP.tenantIds).toHaveLength(1);
  const members = await demoSource(undefined, at(0)).members(signal);
  expect(members.workspaces).toHaveLength(1);
});

test('reads stop when aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(demoSource(run, at(0)).approvals(controller.signal)).rejects.toThrow('Aborted');
});

const remoteOf = (bodies: Record<string, unknown>): DemoRemote & { calls: string[] } => {
  const calls: string[] = [];
  return { calls, read: <T,>(collection: string, _query: Readonly<Record<string, string>>, decode: (value: unknown) => T) => {
    calls.push(collection);
    return collection in bodies ? Promise.resolve(decode(bodies[collection])) : Promise.reject(new Error('down'));
  } };
};
const SERVER_OVERVIEW = { range: '24h', workspaces: [{ tenantId: DEMO_GROUP.tenantIds[0], name: 'Demo workspace', runs: 7, completed: 0, failed: 0, unknownOutcome: 0, p95Seconds: null, tokens: 0, cost: 0, pendingApprovals: 0, previous: { runs: 2, completed: 0, failed: 0, unknownOutcome: 0, p95Seconds: null, tokens: 0, cost: 0 } }], total: { runs: 7, completed: 0, failed: 0, unknownOutcome: 0, p95Seconds: null, tokens: 0, cost: 0, pendingApprovals: 0, previous: { runs: 2, completed: 0, failed: 0, unknownOutcome: 0, p95Seconds: null, tokens: 0, cost: 0 } }, completeness: 'full', classification: 'fixture' };

test('the overview shows the server counts with this visitor\'s pending approval on top', async () => {
  const remote = remoteOf({ overview: SERVER_OVERVIEW });
  const overview = decodeOverview(await demoSource(run, at(60_000), remote).overview('24h', undefined, signal));
  expect(overview.total).toMatchObject({ runs: 7, pendingApprovals: 1 });
  expect(overview.workspaces[0]).toMatchObject({ runs: 7, pendingApprovals: 1 });
  expect(remote.calls).toEqual(['overview']);
});

test('a failing server falls back to the local view for every read', async () => {
  const source = demoSource(run, at(60_000), remoteOf({}));
  expect(decodeOverview(await source.overview('24h', undefined, signal)).total).toMatchObject({ runs: 1, pendingApprovals: 1 });
  expect(decodeWorkflows(await source.workflows('24h', undefined, signal)).workflows[0]).toMatchObject({ runs: 1 });
  expect(decodeLogs(await source.logs({ range: '24h' }, signal)).entries).toHaveLength(4);
  expect(decodeTrace(await source.trace(run.id, signal)).spans).toHaveLength(run.steps.length + 1);
});

test('server logs and traces replace the local ones only when they have content', async () => {
  const entry = { at: '2026-10-07T10:00:00.000Z', event: 'run.started', level: 'info', attributes: { run_id: run.id } };
  const ready = remoteOf({ logs: { range: '24h', status: 'ready', entries: [entry], completeness: 'full', classification: 'fixture' }, trace: { run: run.id, status: 'ready', spans: [{ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), name: 'workflow.run', startMs: START, durationMs: 5, status: 'unset', attributes: {} }], completeness: 'full', classification: 'fixture' } });
  const served = demoSource(run, at(60_000), ready);
  expect(decodeLogs(await served.logs({ range: '24h' }, signal)).entries).toHaveLength(1);
  expect(decodeTrace(await served.trace(run.id, signal)).spans).toHaveLength(1);
  const empty = remoteOf({ logs: { range: '24h', status: 'ready', entries: [], completeness: 'full', classification: 'fixture' }, trace: { run: run.id, status: 'not-configured', spans: [], completeness: 'full', classification: 'fixture' } });
  const lagging = demoSource(run, at(60_000), empty);
  expect(decodeLogs(await lagging.logs({ range: '24h' }, signal)).entries).toHaveLength(4);
  expect(decodeTrace(await lagging.trace(run.id, signal)).spans).toHaveLength(run.steps.length + 1);
});

test('series come from the server and fall back to the local stub', async () => {
  const body = { panel: 'runs-over-time', range: '24h', status: 'ready', series: [{ label: 'demo runs', points: [[START, 3]] }], completeness: 'full', classification: 'fixture' };
  expect((await demoSource(run, at(0), remoteOf({ series: body })).series('runs-over-time', '24h', undefined, signal)).series).toHaveLength(1);
  expect((await demoSource(run, at(0), remoteOf({})).series('runs-over-time', '24h', undefined, signal)).series).toEqual([]);
});
