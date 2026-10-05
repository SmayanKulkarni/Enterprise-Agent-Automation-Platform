import * as df from 'durable-functions';
import type { InvocationContext } from '@azure/functions';
import { AzureSqlWorkflowStore } from '../../../packages/workflow/src/sql.js';
import { WorkflowWorker, type StepResult } from '../../../packages/workflow/src/runtime.js';
import { HttpEmbeddingPort, HttpMcpPort, HttpModelPort, UpstashVectorMemoryPort } from '../../../packages/workflow/src/ports.js';
import { nextTimerAt } from '../../../packages/workflow/src/timers.js';
import { OpenRouterConnectionCrypto } from '../../../packages/workflow/src/openrouter-connection.js';
import { report } from '../../../packages/errors/src/report.js';
import { withFlush } from '../../../packages/telemetry/src/index.js';

interface Input { tenantId: string; runId: string; definitionId: string; }

const logged = <I extends { tenantId: string; runId?: string }, O>(site: string, handler: (input: I) => Promise<O>) => withFlush(async (input: I): Promise<O> => {
  try { return await handler(input); } catch (error) { report(error, { site, tenantId: input.tenantId, ...(input.runId ? { correlationId: input.runId } : {}) }); throw error; }
});

const store = (): AzureSqlWorkflowStore => new AzureSqlWorkflowStore(process.env['AZURE_SQL_CONNECTION_STRING'] ?? '');
const worker = (): WorkflowWorker => { const workflowStore = store(); const crypto = process.env['WORKFLOW_OPENROUTER_WRAPPING_KEY'] && process.env['WORKFLOW_OPENROUTER_WRAPPING_KEY_VERSION'] ? OpenRouterConnectionCrypto.fromEnvironment(process.env) : undefined; return new WorkflowWorker(workflowStore, new HttpModelPort(process.env, workflowStore, crypto), new HttpMcpPort(), new UpstashVectorMemoryPort(process.env, new HttpEmbeddingPort(process.env, workflowStore, crypto))); };

df.app.activity('workflowStep', { handler: logged('workflowStep', async (input: Input & { nodeId: string }) => worker().step(input.tenantId, input.runId, input.definitionId, input.nodeId)) });
df.app.activity('workflowExpire', { handler: logged('workflowExpire', async (input: Input & { nodeId: string }) => worker().expire(input.tenantId, input.runId, input.nodeId)) });
df.app.activity('workflowFinalize', { handler: logged('workflowFinalize', async (input: Input) => worker().finalize(input.tenantId, input.runId)) });
df.app.activity('workflowSummary', { handler: logged('workflowSummary', async (input: Input) => worker().summarize(input.tenantId, input.runId)) });
df.app.activity('workflowSummaryFailed', { handler: logged('workflowSummaryFailed', async (input: Input) => worker().summaryFailed(input.tenantId, input.runId)) });
df.app.activity('workflowMemoryPromote', { handler: logged('workflowMemoryPromote', async (input: Input) => worker().promote(input.tenantId, input.runId)) });
df.app.activity('workflowMemoryRemove', { handler: logged('workflowMemoryRemove', async (input: { tenantId: string; itemId: string }) => worker().remove(input.tenantId, input.itemId)) });
df.app.activity('workflowMemoryCorrect', { handler: logged('workflowMemoryCorrect', async (input: { tenantId: string; itemId: string; text: string }) => worker().correct(input.tenantId, input.itemId, input.text)) });

const MAX_ORCHESTRATION_TURNS = 1000;

function* walkRun(context: df.OrchestrationContext, input: Input): Generator<df.Task, void, unknown> {
  const published = (yield context.df.callActivity('workflowDefinitionStart', input)) as { start: string };
  let nodeId = published.start;
  for (let count = 0; count < MAX_ORCHESTRATION_TURNS; count += 1) {
    const result = (yield context.df.callActivity('workflowStep', { ...input, nodeId })) as StepResult;
    if (result.failed) return;
    if (result.completed) { try { yield context.df.callActivity('workflowFinalize', input); } catch { } try { yield context.df.callActivityWithRetry('workflowSummary', new df.RetryOptions(1000, 3), input); } catch { yield context.df.callActivity('workflowSummaryFailed', input); } try { yield context.df.callActivityWithRetry('workflowMemoryPromote', new df.RetryOptions(1000, 3), input); } catch {} return; }
    if (result.waiting === 'circuit') { yield context.df.createTimer(new Date(result.deadline!)); continue; }
    if (result.waiting) {
      const deadline = Date.parse(result.deadline!);
      const signal = context.df.waitForExternalEvent(result.waiting);
      let timedOut = false;
      for (;;) {
        const timer = context.df.createTimer(new Date(nextTimerAt(context.df.currentUtcDateTime.getTime(), deadline)));
        const winner = yield context.df.Task.any([timer, signal]);
        if (winner !== timer) { timer.cancel(); break; }
        if (context.df.currentUtcDateTime.getTime() >= deadline) { timedOut = true; break; }
      }
      if (timedOut) { const expired = (yield context.df.callActivity('workflowExpire', { ...input, nodeId })) as StepResult; if (expired.next) { nodeId = expired.next; continue; } return; }
      const event = signal.result as { decision?: string; bindingDigest?: string; effectId?: string } | undefined;
      if (result.waiting === 'approval' && event?.bindingDigest !== result.bindingDigest || result.waiting === 'connector' && event?.effectId !== result.effectId) continue;
      if (result.waiting === 'approval' && event?.decision !== 'approve') return;
      continue;
    }
    if (!result.next) return;
    nodeId = result.next;
  }
}

df.app.orchestration('workflowRun', function* (context) {
  const input = context.df.getInput<Input>();
  let failure: unknown;
  try { yield* walkRun(context, input); } catch (error) { failure = error; }
  try { yield context.df.callActivity('workflowFinalize', input); } catch { }
  if (failure !== undefined) throw failure;
});

df.app.activity('workflowDefinitionStart', { handler: withFlush(async (input: Input) => {
  const definition = await store().workerDefinition(input.tenantId, input.definitionId);
  if (!definition) throw new Error('NOT_FOUND');
  return { start: definition.definition.start };
}) });

export function durableScheduler(context: InvocationContext) {
  const client = df.getClient(context);
  const instance = (runId: string): string => runId.toLowerCase();
  const existing = (runId: string) => client.getStatus(instance(runId)).catch(() => undefined);
  return {
    async start(runId: string, tenantId: string, definitionId: string): Promise<void> { if (await existing(runId)) return; try { await client.startNew('workflowRun', { instanceId: instance(runId), input: { runId, tenantId, definitionId } }); } catch (error) { if (!await existing(runId)) throw error; } },
    async raise(runId: string, name: string, value: unknown): Promise<void> { await client.raiseEvent(instance(runId), name, value); },
    async promoteMemory(runId: string, tenantId: string): Promise<void> { await client.startNew('workflowMemoryPromotion', { instanceId: `memory-promotion-${runId}`, input: { runId, tenantId } }); },
    async correctMemory(itemId: string, tenantId: string, text: string): Promise<void> { await client.startNew('workflowMemoryCorrection', { instanceId: `memory-correct-${itemId}`, input: { itemId, tenantId, text } }); },
    async removeMemory(itemId: string, tenantId: string): Promise<void> { await client.startNew('workflowMemoryRemoval', { instanceId: `memory-remove-${itemId}`, input: { itemId, tenantId } }); },
  };
}

df.app.orchestration('workflowMemoryPromotion', function* (context) { const input = context.df.getInput<Input>(); yield context.df.callActivityWithRetry('workflowMemoryPromote', new df.RetryOptions(1000, 3), input); });
df.app.orchestration('workflowMemoryRemoval', function* (context) { const input = context.df.getInput<{ tenantId: string; itemId: string }>(); yield context.df.callActivityWithRetry('workflowMemoryRemove', new df.RetryOptions(1000, 3), input); });
df.app.orchestration('workflowMemoryCorrection', function* (context) { const input = context.df.getInput<{ tenantId: string; itemId: string; text: string }>(); yield context.df.callActivityWithRetry('workflowMemoryCorrect', new df.RetryOptions(1000, 3), input); });
