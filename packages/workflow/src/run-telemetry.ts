import { logEvent } from '../../telemetry/src/events.js';
import { count, record } from '../../telemetry/src/instruments.js';
import type { NonFailureOutcome, WorkflowRun } from './service.js';

const REASON = /^[A-Z][A-Z0-9_]{0,63}$/u;

export type RunTrigger = 'manual' | 'webhook';
export type FinishedStatus = 'completed' | 'failed' | 'unknown-outcome' | NonFailureOutcome;
export type ApprovalKind = 'step' | 'tool';
export type CircuitState = 'open' | 'probe' | 'closed';

const secondsSince = (at: string | undefined): number | undefined => {
  const started = at === undefined ? Number.NaN : Date.parse(at);
  return Number.isFinite(started) ? Math.max(0, (Date.now() - started) / 1000) : undefined;
};

export function runStarted(tenantId: string, runId: string, definitionId: string, trigger: RunTrigger, ownerId: string): void {
  count('workflow.runs.started', { tenant_id: tenantId, trigger });
  logEvent('run.started', { tenant_id: tenantId, run_id: runId, definition_id: definitionId, trigger, owner_id: ownerId });
}

export function runFinished(tenantId: string, run: WorkflowRun, status: FinishedStatus, code?: string): void {
  const reason = code === undefined ? undefined : REASON.test(code) ? code : 'OTHER';
  count('workflow.runs.finished', { tenant_id: tenantId, status, reason });
  logEvent('run.finished', { tenant_id: tenantId, run_id: run.id, definition_id: run.definitionId, status, reason, duration_s: secondsSince(run.history[0]?.at), tokens: run.usage?.tokens, cost: run.usage?.cost }, status === 'completed' ? 'info' : 'warn');
}

export function nodeFailed(tenantId: string, runId: string, nodeId: string, nodeKind: string, code: string): void {
  logEvent('node.failed', { tenant_id: tenantId, run_id: runId, node_id: nodeId, node_kind: nodeKind, code: REASON.test(code) ? code : 'OTHER' }, 'warn');
}

export function approvalRequested(tenantId: string, runId: string, nodeId: string, kind: ApprovalKind, capability: string, expiresAt: string): void {
  count('workflow.approvals.requested', { tenant_id: tenantId, kind });
  logEvent('approval.requested', { tenant_id: tenantId, run_id: runId, node_id: nodeId, kind, capability, expires_at: expiresAt });
}

export function approvalDecided(tenantId: string, runId: string, decision: 'approve' | 'reject', actorUserId: string, requestedAt: string | undefined): void {
  const waited = secondsSince(requestedAt);
  count('workflow.approvals.decided', { tenant_id: tenantId, decision });
  if (waited !== undefined) record('workflow.approval.wait.duration', waited, { tenant_id: tenantId, decision });
  logEvent('approval.decided', { tenant_id: tenantId, run_id: runId, decision, actor_user_id: actorUserId, wait_s: waited });
}

export function approvalExpired(tenantId: string, runId: string, nodeId: string): void {
  count('workflow.approvals.expired', { tenant_id: tenantId });
  logEvent('approval.expired', { tenant_id: tenantId, run_id: runId, node_id: nodeId }, 'warn');
}

export function circuitTransition(tenantId: string, key: string, state: CircuitState): void {
  const kind = key.split(':', 1)[0];
  count('workflow.circuit.transitions', { tenant_id: tenantId, kind, state });
  logEvent('circuit.transition', { tenant_id: tenantId, kind, state }, state === 'open' ? 'warn' : 'info');
}

export function memoryRetrieved(tenantId: string, runId: string, nodeId: string, status: string, itemCount: number): void {
  count('memory.retrievals', { tenant_id: tenantId, status });
  logEvent('memory.retrieval', { tenant_id: tenantId, run_id: runId, node_id: nodeId, status, item_count: itemCount });
}

export function memorySummarized(tenantId: string, runId: string, outcome: 'staged' | 'skipped' | 'ungrounded' | 'rejected', findings: number, dropped: number): void {
  count('memory.summaries', { tenant_id: tenantId, outcome });
  logEvent('memory.summary', { tenant_id: tenantId, run_id: runId, outcome, findings, dropped }, outcome === 'staged' || outcome === 'skipped' ? 'info' : 'warn');
}

export function memoryConsolidated(tenantId: string, runId: string, decision: 'add' | 'supersede' | 'noop', path: 'deterministic' | 'model' | 'fallback', candidates: number): void {
  count('memory.consolidation', { tenant_id: tenantId, decision, path });
  logEvent('memory.consolidation', { tenant_id: tenantId, run_id: runId, decision, path, candidates });
}
