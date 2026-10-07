import { expect, test } from 'vitest';
import { SAMPLE_DIFF, SAMPLE_PULL_REQUEST, runDemo } from '../../../../packages/workflow/src/pr-gate-demo.js';
import { DEMO_GROUP, demoSource } from './demo-source.js';
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
