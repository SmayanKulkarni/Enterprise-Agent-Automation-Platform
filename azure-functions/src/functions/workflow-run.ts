import * as df from 'durable-functions';
import type { InvocationContext } from '@azure/functions';
import { AzureSqlWorkflowStore } from '../../../packages/workflow/src/sql.js';
import { WorkflowWorker, type StepResult } from '../../../packages/workflow/src/runtime.js';
import { HttpMcpPort, HttpModelPort, UpstashVectorMemoryPort } from '../../../packages/workflow/src/ports.js';

interface Input { tenantId: string; runId: string; definitionId: string; }

const store = (): AzureSqlWorkflowStore => new AzureSqlWorkflowStore(process.env['AZURE_SQL_CONNECTION_STRING'] ?? '');
const worker = (): WorkflowWorker => new WorkflowWorker(store(), new HttpModelPort(), new HttpMcpPort(), new UpstashVectorMemoryPort());

df.app.activity('workflowStep', { handler: async (input: Input & { nodeId: string }) => worker().step(input.tenantId, input.runId, input.definitionId, input.nodeId) });
df.app.activity('workflowExpire', { handler: async (input: Input & { nodeId: string }) => worker().expire(input.tenantId, input.runId, input.nodeId) });
df.app.activity('workflowSummary', { handler: async (input: Input) => worker().summarize(input.tenantId, input.runId) });
df.app.activity('workflowSummaryFailed', { handler: async (input: Input) => worker().summaryFailed(input.tenantId, input.runId) });
df.app.activity('workflowMemoryPromote', { handler: async (input: Input) => worker().promote(input.tenantId, input.runId) });
df.app.activity('workflowMemoryRemove', { handler: async (input: { tenantId: string; itemId: string }) => worker().remove(input.tenantId, input.itemId) });
df.app.activity('workflowMemoryCorrect', { handler: async (input: { tenantId: string; itemId: string; text: string }) => worker().correct(input.tenantId, input.itemId, input.text) });

df.app.orchestration('workflowRun', function* (context) {
  const input = context.df.getInput<Input>();
  const published = (yield context.df.callActivity('workflowDefinitionStart', input)) as { start: string };
  let nodeId = published.start;
  for (let count = 0; count < 100; count += 1) {
    const result = (yield context.df.callActivity('workflowStep', { ...input, nodeId })) as StepResult;
    if (result.failed) return;
    if (result.completed) { try { yield context.df.callActivityWithRetry('workflowSummary', new df.RetryOptions(1000, 3), input); } catch { yield context.df.callActivity('workflowSummaryFailed', input); } try { yield context.df.callActivityWithRetry('workflowMemoryPromote', new df.RetryOptions(1000, 3), input); } catch {} return; }
    if (result.waiting === 'circuit') { yield context.df.createTimer(new Date(result.deadline!)); continue; }
    if (result.waiting) {
      const timer = context.df.createTimer(new Date(result.deadline!));
      const signal = context.df.waitForExternalEvent(result.waiting);
      const winner = yield context.df.Task.any([timer, signal]);
      if (winner === timer) { const expired = (yield context.df.callActivity('workflowExpire', { ...input, nodeId })) as StepResult; if (expired.next) { nodeId = expired.next; continue; } return; }
      timer.cancel();
      const event = signal.result as { decision?: string; bindingDigest?: string; effectId?: string } | undefined;
      if (result.waiting === 'approval' && event?.bindingDigest !== result.bindingDigest || result.waiting === 'connector' && event?.effectId !== result.effectId) continue;
      if (result.waiting === 'approval' && event?.decision !== 'approve') return;
      continue;
    }
    if (!result.next) return;
    nodeId = result.next;
  }
});

df.app.activity('workflowDefinitionStart', { handler: async (input: Input) => {
  const definition = await store().workerDefinition(input.tenantId, input.definitionId);
  if (!definition) throw new Error('NOT_FOUND');
  return { start: definition.definition.start };
} });

export function durableScheduler(context: InvocationContext) {
  const client = df.getClient(context);
  return {
    async start(runId: string, tenantId: string, definitionId: string): Promise<void> { if (await client.getStatus(runId)) return; try { await client.startNew('workflowRun', { instanceId: runId, input: { runId, tenantId, definitionId } }); } catch (error) { if (!await client.getStatus(runId)) throw error; } },
    async raise(runId: string, name: string, value: unknown): Promise<void> { await client.raiseEvent(runId, name, value); },
    async promoteMemory(runId: string, tenantId: string): Promise<void> { await client.startNew('workflowMemoryPromotion', { instanceId: `memory-promotion-${runId}`, input: { runId, tenantId } }); },
    async correctMemory(itemId: string, tenantId: string, text: string): Promise<void> { await client.startNew('workflowMemoryCorrection', { instanceId: `memory-correct-${itemId}`, input: { itemId, tenantId, text } }); },
    async removeMemory(itemId: string, tenantId: string): Promise<void> { await client.startNew('workflowMemoryRemoval', { instanceId: `memory-remove-${itemId}`, input: { itemId, tenantId } }); },
  };
}

df.app.orchestration('workflowMemoryPromotion', function* (context) { const input = context.df.getInput<Input>(); yield context.df.callActivityWithRetry('workflowMemoryPromote', new df.RetryOptions(1000, 3), input); });
df.app.orchestration('workflowMemoryRemoval', function* (context) { const input = context.df.getInput<{ tenantId: string; itemId: string }>(); yield context.df.callActivityWithRetry('workflowMemoryRemove', new df.RetryOptions(1000, 3), input); });
df.app.orchestration('workflowMemoryCorrection', function* (context) { const input = context.df.getInput<{ tenantId: string; itemId: string; text: string }>(); yield context.df.callActivityWithRetry('workflowMemoryCorrect', new df.RetryOptions(1000, 3), input); });
