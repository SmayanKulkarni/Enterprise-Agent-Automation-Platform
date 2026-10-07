import { afterEach, expect, test } from 'vitest';
import { observe, resetObservers } from '../../telemetry/src/observe.test-support.js';
import { DEMO_DEFINITION_ID, DEMO_TENANT_ID, SAMPLE_DIFF, SAMPLE_PULL_REQUEST, runDemo } from '../../workflow/src/pr-gate-demo.js';
import { emitDemoTelemetry } from './demo-telemetry.js';

afterEach(resetObservers);

const run = () => runDemo({ id: 'e0000000-0000-4000-8000-000000000001', now: Date.parse('2026-10-07T10:00:00.000Z'), pullRequest: SAMPLE_PULL_REQUEST, diff: SAMPLE_DIFF, source: 'sample' });

test('the run is reported under the demo tenant with the real event names', () => {
  const seen = observe();
  emitDemoTelemetry(run());
  expect(seen.events('run.started')).toEqual([expect.objectContaining({ tenant_id: DEMO_TENANT_ID, run_id: 'e0000000-0000-4000-8000-000000000001', definition_id: DEMO_DEFINITION_ID, trigger: 'manual' })]);
  expect(seen.events('approval.requested')).toEqual([expect.objectContaining({ tenant_id: DEMO_TENANT_ID, run_id: 'e0000000-0000-4000-8000-000000000001', kind: 'step' })]);
  expect(seen.events('mcp.call').length).toBeGreaterThan(0);
  expect(seen.events('mcp.call').every((line) => line['tenant_id'] === DEMO_TENANT_ID && line['route'] === 'demo')).toBe(true);
  expect(seen.events('demo.run')).toEqual([expect.objectContaining({ tenant_id: DEMO_TENANT_ID, source: 'sample', branch: 'return' })]);
});

test('the metrics carry the demo tenant', async () => {
  const seen = observe();
  emitDemoTelemetry(run());
  expect(await seen.points('workflow.runs.started')).toEqual([expect.objectContaining({ attributes: { tenant_id: DEMO_TENANT_ID, trigger: 'manual' } })]);
  expect(await seen.points('workflow.approvals.requested')).toEqual([expect.objectContaining({ attributes: { tenant_id: DEMO_TENANT_ID, kind: 'step' } })]);
  expect(await seen.points('demo.runs')).toEqual([expect.objectContaining({ attributes: { source: 'sample', outcome: 'return' } })]);
});

test('one trace per run: a root span and a span per step, queryable by run id and tenant', async () => {
  const seen = observe();
  const demo = run();
  emitDemoTelemetry(demo);
  const spans = await seen.spans();
  const root = spans.find((span) => span.name === 'workflow.run');
  expect(root?.attributes).toMatchObject({ 'workflow.run_id': demo.id, tenant_id: DEMO_TENANT_ID });
  const children = spans.filter((span) => span.name !== 'workflow.run');
  expect(children).toHaveLength(demo.steps.length);
  expect(children.every((span) => span.parentSpanContext?.spanId === root?.spanContext().spanId && span.attributes['workflow.run_id'] === demo.id && span.attributes['tenant_id'] === DEMO_TENANT_ID)).toBe(true);
  expect(children.map((span) => span.attributes['workflow.node_id'])).toEqual(demo.steps.map((step) => step.nodeId));
});

test('nothing sensitive about the pull request or verdict leaves the process', async () => {
  const seen = observe();
  emitDemoTelemetry(run());
  const everything = await seen.everything();
  expect(everything).not.toContain(SAMPLE_PULL_REQUEST.title);
  expect(everything).not.toContain(SAMPLE_PULL_REQUEST.owner);
  expect(everything).not.toContain('demo-not-a-real-key');
});
