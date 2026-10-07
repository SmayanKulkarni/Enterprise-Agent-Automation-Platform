import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import { logEvent } from '../../telemetry/src/events.js';
import { count } from '../../telemetry/src/instruments.js';
import { DEMO_DEFINITION_ID, DEMO_TENANT_ID, type DemoRun } from '../../workflow/src/pr-gate-demo.js';

const APPROVAL_WINDOW_MS = 86_400_000;
const ID = { tenant_id: DEMO_TENANT_ID } as const;

function traceRun(run: DemoRun): void {
  const tracer = trace.getTracer('workflow');
  const started = Date.parse(run.startedAt);
  const total = run.steps.reduce((sum, step) => sum + step.durationMs, 0);
  const attributes = { ...ID, 'workflow.run_id': run.id };
  const root = tracer.startSpan('workflow.run', { startTime: started, attributes });
  const parent = trace.setSpan(context.active(), root);
  for (const step of run.steps) {
    const span = tracer.startSpan(`${step.kind}.${step.nodeId}`, { startTime: started + step.startMs, attributes: { ...attributes, 'workflow.node_id': step.nodeId, node_kind: step.kind } }, parent);
    span.setStatus({ code: step.state === 'waiting' ? SpanStatusCode.UNSET : SpanStatusCode.OK });
    span.end(started + step.startMs + step.durationMs);
  }
  root.end(started + total);
}

export function emitDemoTelemetry(run: DemoRun): void {
  const started = Date.parse(run.startedAt);
  traceRun(run);
  logEvent('run.started', { ...ID, run_id: run.id, definition_id: DEMO_DEFINITION_ID, trigger: 'manual', owner_id: 'demo-visitor' });
  for (const step of run.steps.filter((item) => item.kind === 'mcp')) logEvent('mcp.call', { ...ID, run_id: run.id, node_id: step.nodeId, capability: 'pull_request_read', route: 'demo', outcome: 'succeeded', duration_s: step.durationMs / 1000 });
  logEvent('approval.requested', { ...ID, run_id: run.id, node_id: run.waitingNodeId, kind: 'step', capability: run.branch === 'accept' ? 'merge_pull_request' : 'issue_write', expires_at: new Date(started + APPROVAL_WINDOW_MS).toISOString() });
  logEvent('demo.run', { ...ID, run_id: run.id, source: run.source, outcome: run.outcome, branch: run.branch });
  count('workflow.runs.started', { ...ID, trigger: 'manual' });
  count('workflow.approvals.requested', { ...ID, kind: 'step' });
  count('demo.runs', { source: run.source, outcome: run.branch });
}
