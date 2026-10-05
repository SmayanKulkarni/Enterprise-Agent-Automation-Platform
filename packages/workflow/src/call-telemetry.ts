import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { logEvent } from '../../telemetry/src/events.js';
import { count, record } from '../../telemetry/src/instruments.js';
import type { JudgmentRequest, JudgmentResult, ModelRequest, ModelResult } from './runtime.js';

const tracer = () => trace.getTracer('workflow');
const PROVIDER_ERRORS: ReadonlySet<string> = new Set(['PROVIDER_FAILED', 'INVALID_PROVIDER_RESPONSE', 'INVALID_MODEL_OUTPUT', 'DENIED', 'INVALID_COST_RATE']);

export interface McpCallContext { tenantId: string; runId: string; nodeId: string; capability: string; effectId: string; }
type Settled<Value> = { value: Value } | { error: unknown };

const settle = <Value>(call: () => Promise<Value>): Promise<Settled<Value>> => call().then((value) => ({ value }), (error: unknown) => ({ error }));
const seconds = (started: number): number => (performance.now() - started) / 1000;

export function modelErrorType(error: unknown): string {
  if (!(error instanceof Error)) return 'other';
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'timeout';
  return PROVIDER_ERRORS.has(error.message) ? error.message : 'other';
}

export async function observeModelCall(request: ModelRequest, call: () => Promise<ModelResult>): Promise<ModelResult> {
  const telemetry = request.telemetry; const feature = telemetry?.feature ?? 'workflow';
  const attributes = { 'gen_ai.operation.name': 'chat', 'gen_ai.provider.name': request.provider, 'gen_ai.request.model': request.model, tenant_id: request.tenantId, feature, ...(telemetry?.runId ? { 'workflow.run_id': telemetry.runId } : {}), ...(telemetry?.nodeId ? { 'workflow.node_id': telemetry.nodeId } : {}) };
  const started = performance.now();
  return tracer().startActiveSpan(`chat ${request.model}`, { kind: SpanKind.CLIENT, attributes }, async (span) => {
    const settled = await settle(call);
    const failure = 'error' in settled ? modelErrorType(settled.error) : undefined;
    try {
      if (failure !== undefined) { span.setAttribute('error.type', failure); span.setStatus({ code: SpanStatusCode.ERROR, message: failure }); }
      const labels = { 'gen_ai.provider.name': request.provider, 'gen_ai.request.model': request.model, tenant_id: request.tenantId, feature };
      const duration = seconds(started); const result = 'value' in settled ? settled.value : undefined;
      record('gen_ai.client.operation.duration', duration, { ...labels, 'error.type': failure });
      if (result?.promptTokens !== undefined && result.completionTokens !== undefined) {
        record('gen_ai.client.token.usage', result.promptTokens, { ...labels, 'gen_ai.token.type': 'input' });
        record('gen_ai.client.token.usage', result.completionTokens, { ...labels, 'gen_ai.token.type': 'output' });
      } else if (result !== undefined) record('gen_ai.client.token.usage', result.tokens, { ...labels, 'gen_ai.token.type': 'total' });
      if (result !== undefined) count('gen_ai.client.cost', labels, result.cost);
      logEvent('model.call', { tenant_id: request.tenantId, run_id: telemetry?.runId, node_id: telemetry?.nodeId, provider: request.provider, model: request.model, attempt: telemetry?.attempt, outcome: failure === undefined ? 'succeeded' : 'failed', tokens: result?.tokens, cost: result?.cost, duration_s: duration });
    } finally { span.end(); }
    if ('error' in settled) throw settled.error;
    return settled.value;
  });
}

export async function observeJudgmentCall(request: JudgmentRequest, call: () => Promise<JudgmentResult>): Promise<JudgmentResult> {
  const telemetry = request.telemetry; const feature = 'judgment';
  const attributes = { 'gen_ai.operation.name': 'decision', 'gen_ai.provider.name': 'openrouter', 'gen_ai.request.model': request.model, tenant_id: request.tenantId, feature, ...(telemetry.runId ? { 'workflow.run_id': telemetry.runId } : {}), ...(telemetry.nodeId ? { 'workflow.node_id': telemetry.nodeId } : {}) };
  const started = performance.now();
  return tracer().startActiveSpan(`decide ${request.model}`, { kind: SpanKind.CLIENT, attributes }, async (span) => {
    const settled = await settle(call);
    const failure = 'error' in settled ? modelErrorType(settled.error) : undefined;
    try {
      if (failure !== undefined) { span.setAttribute('error.type', failure); span.setStatus({ code: SpanStatusCode.ERROR, message: failure }); }
      const labels = { 'gen_ai.provider.name': 'openrouter', 'gen_ai.request.model': request.model, tenant_id: request.tenantId, feature };
      const duration = seconds(started); const result = 'value' in settled ? settled.value : undefined;
      record('gen_ai.client.operation.duration', duration, { ...labels, 'error.type': failure });
      if (result?.promptTokens !== undefined && result.completionTokens !== undefined) {
        record('gen_ai.client.token.usage', result.promptTokens, { ...labels, 'gen_ai.token.type': 'input' });
        record('gen_ai.client.token.usage', result.completionTokens, { ...labels, 'gen_ai.token.type': 'output' });
      } else if (result !== undefined) record('gen_ai.client.token.usage', result.tokens, { ...labels, 'gen_ai.token.type': 'total' });
      if (result !== undefined) count('gen_ai.client.cost', labels, result.cost);
      logEvent('judgment.call', { tenant_id: request.tenantId, run_id: telemetry.runId, node_id: telemetry.nodeId, model: request.model, question_count: Object.keys(request.questions).length, attempt: telemetry.attempt, outcome: failure === undefined ? 'succeeded' : 'failed', tokens: result?.tokens, cost: result?.cost, duration_s: duration });
    } finally { span.end(); }
    if ('error' in settled) throw settled.error;
    return settled.value;
  });
}

export async function observeMcpCall<Result extends { outcome: string }>(context: McpCallContext, call: () => Promise<Result>): Promise<Result> {
  const started = performance.now();
  return tracer().startActiveSpan('mcp.call', { kind: SpanKind.CLIENT, attributes: { tenant_id: context.tenantId, capability: context.capability, route: 'public', 'workflow.run_id': context.runId, 'workflow.node_id': context.nodeId } }, async (span) => {
    const settled = await settle(call);
    const outcome = 'value' in settled ? settled.value.outcome : 'unknown-outcome';
    try {
      if (outcome !== 'succeeded') span.setStatus({ code: SpanStatusCode.ERROR, message: outcome });
      const duration = seconds(started);
      record('mcp.tool.call.duration', duration, { tenant_id: context.tenantId, capability: context.capability, outcome, route: 'public' });
      logEvent('mcp.call', { tenant_id: context.tenantId, run_id: context.runId, node_id: context.nodeId, capability: context.capability, route: 'public', outcome, duration_s: duration, effect_id: context.effectId });
    } finally { span.end(); }
    if ('error' in settled) throw settled.error;
    return settled.value;
  });
}

export function logQueuedMcpCall(context: McpCallContext): void {
  logEvent('mcp.call', { tenant_id: context.tenantId, run_id: context.runId, node_id: context.nodeId, capability: context.capability, route: 'private', outcome: 'queued', effect_id: context.effectId });
}
