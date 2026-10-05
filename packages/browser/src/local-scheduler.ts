import { WorkflowWorker, type StepResult } from '../../workflow/src/runtime.js';
import type { Scheduler } from '../../workflow/src/service.js';
import type { WorkflowStore } from '../../workflow/src/sql.js';
import { report } from '../../errors/src/report.js';

const MAX_TURNS = 1000;
const MEMORY_RETRIES = 3;
const STALE_RETRIES = 5;
const STALE_RETRY_MS = 500;

const IN_FLIGHT = new Set(['queued', 'running', 'waiting-approval', 'waiting-connector']);

type Event = { decision?: string; bindingDigest?: string; effectId?: string };

export function localScheduler(worker: WorkflowWorker, store: Pick<WorkflowStore, 'workerDefinition'>): Scheduler {
  const waiters = new Map<string, (event: Event) => void>();
  const buffered = new Map<string, Event[]>();
  const running = new Set<string>();

  const nextEvent = (runId: string, name: string, deadline: string): Promise<Event | undefined> => {
    const key = `${runId.toLowerCase()}:${name}`;
    const early = buffered.get(key)?.shift();
    if (early) return Promise.resolve(early);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { waiters.delete(key); resolve(undefined); }, Math.max(0, Date.parse(deadline) - Date.now()));
      waiters.set(key, (event) => { clearTimeout(timer); waiters.delete(key); resolve(event); });
    });
  };

  const retry = async (work: () => Promise<void>): Promise<boolean> => {
    for (let attempt = 0; attempt < MEMORY_RETRIES; attempt += 1) {
      try { await work(); return true; } catch (error) { report(error, { site: 'localScheduler.retry' }); await new Promise((resolve) => setTimeout(resolve, 1000)); }
    }
    return false;
  };

  const stepWithRetry = async (runId: string, tenantId: string, definitionId: string, nodeId: string): Promise<StepResult> => {
    for (let attempt = 0; ; attempt += 1) {
      try { return await worker.step(tenantId, runId, definitionId, nodeId); }
      catch (error) {
        if (attempt >= STALE_RETRIES || !(error instanceof Error && 'code' in error && error.code === 'STALE')) throw error;
        await new Promise((resolve) => setTimeout(resolve, STALE_RETRY_MS));
      }
    }
  };

  const drive = async (runId: string, tenantId: string, definitionId: string): Promise<void> => {
    let finalized = false;
    const finalize = async (): Promise<void> => {
      if (finalized) return;
      finalized = true;
      await worker.finalize(tenantId, runId).catch((error: unknown) => report(error, { site: 'localScheduler.finalize', tenantId, correlationId: runId }));
    };
    try { await walk(runId, tenantId, definitionId, finalize); }
    finally { await finalize(); }
  };

  const walk = async (runId: string, tenantId: string, definitionId: string, finalize: () => Promise<void>): Promise<void> => {
    const definition = await store.workerDefinition(tenantId, definitionId);
    if (!definition) throw new Error('NOT_FOUND');
    let nodeId = definition.definition.start;
    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      const result: StepResult = await stepWithRetry(runId, tenantId, definitionId, nodeId);
      if (result.failed) return;
      if (result.completed) {
        await finalize();
        if (!await retry(() => worker.summarize(tenantId, runId))) await worker.summaryFailed(tenantId, runId);
        await retry(() => worker.promote(tenantId, runId));
        return;
      }
      if (result.waiting === 'circuit') { await new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(result.deadline as string) - Date.now()))); continue; }
      if (result.waiting) {
        const deadline = result.deadline as string;
        const event = await nextEvent(runId, result.waiting, deadline);
        if (!event) { const expired = await worker.expire(tenantId, runId, nodeId); if (expired.next) { nodeId = expired.next; continue; } return; }
        if (result.waiting === 'approval' && event.bindingDigest !== result.bindingDigest || result.waiting === 'connector' && event.effectId !== result.effectId) continue;
        if (result.waiting === 'approval' && event.decision !== 'approve') return;
        continue;
      }
      if (!result.next) return;
      nodeId = result.next;
    }
  };

  return {
    start(runId, tenantId, definitionId) {
      const instance = runId.toLowerCase();
      if (running.has(instance)) return Promise.resolve();
      running.add(instance);
      void drive(runId, tenantId, definitionId).catch((error: unknown) => report(error, { site: 'localScheduler.drive', tenantId, correlationId: runId })).finally(() => running.delete(instance));
      return Promise.resolve();
    },
    raise(runId, name, value) {
      const key = `${runId.toLowerCase()}:${name}`;
      const waiter = waiters.get(key);
      if (waiter) waiter(value as Event);
      else buffered.set(key, [...(buffered.get(key) ?? []), value as Event]);
      return Promise.resolve();
    },
    async promoteMemory(runId, tenantId) { await worker.promote(tenantId, runId); },
    async correctMemory(itemId, tenantId, text) { await worker.correct(tenantId, itemId, text); },
    async removeMemory(itemId, tenantId) { await worker.remove(tenantId, itemId); },
  };
}

export async function recoverLocalRuns(store: Pick<WorkflowStore, 'workerList'>, scheduler: Scheduler, tenantIds: readonly string[]): Promise<number> {
  let recovered = 0;
  for (const tenantId of tenantIds) {
    for (const run of await store.workerList<{ definitionId: string }>(tenantId, 'run')) {
      if (!IN_FLIGHT.has(run.state)) continue;
      await scheduler.start(run.id, tenantId, run.data.definitionId);
      recovered += 1;
    }
  }
  return recovered;
}
