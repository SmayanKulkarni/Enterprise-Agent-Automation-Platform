import { createHash } from 'node:crypto';
import type { Scheduler, RunEvent, WorkflowRun } from './service.js';
import type { WorkflowStore } from './sql.js';

export interface Subject { key: string; version: string; }
interface SubjectHead { runId: string; version: string; }

const HEAD_ATTEMPTS = 3;
const IN_FLIGHT: readonly string[] = ['queued', 'running', 'waiting-approval'];

export const subjectOf = (config: Record<string, unknown>, input: Record<string, unknown>): Subject | undefined => {
  const names = config['subjectKey']; const version = config['subjectVersion'];
  if (!Array.isArray(names) || typeof version !== 'string') return undefined;
  return { key: names.map((name) => String(input[String(name)])).join('#'), version: String(input[version]) };
};

export const subjectHeadId = (tenantId: string, definitionId: string, key: string): string => {
  const bytes = createHash('sha256').update(`${tenantId}:${definitionId}:${key}:subject-head`).digest(); bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return `${bytes.subarray(0, 4).toString('hex')}-${bytes.subarray(4, 6).toString('hex')}-${bytes.subarray(6, 8).toString('hex')}-${bytes.subarray(8, 10).toString('hex')}-${bytes.subarray(10, 16).toString('hex')}`;
};

export const isSubjectHead = async (store: Pick<WorkflowStore, 'workerRead'>, run: WorkflowRun): Promise<boolean> => run.subject === undefined || (await store.workerRead<SubjectHead>(run.tenantId, 'webhook-dispatch', subjectHeadId(run.tenantId, run.definitionId, run.subject.key)))?.data.runId === run.id;

async function claimHead(store: WorkflowStore, tenantId: string, definitionId: string, run: WorkflowRun): Promise<string | undefined> {
  const subject = run.subject as Subject; const id = subjectHeadId(tenantId, definitionId, subject.key);
  for (let attempt = 0; attempt < HEAD_ATTEMPTS; attempt += 1) {
    const head = await store.workerRead<SubjectHead>(tenantId, 'webhook-dispatch', id);
    try { await store.workerWrite<SubjectHead>(tenantId, 'webhook-dispatch', id, head?.version ?? 0, 'subject-head', { runId: run.id, version: subject.version }); return head?.data.runId; }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'STALE')) throw error; }
  }
  throw Object.assign(new Error('STALE'), { code: 'STALE' });
}

async function supersede(store: WorkflowStore, scheduler: Scheduler, tenantId: string, runId: string): Promise<void> {
  const previous = await store.workerRead<WorkflowRun>(tenantId, 'run', runId);
  if (!previous || !IN_FLIGHT.includes(previous.data.status)) return;
  const waiting = previous.data.waiting;
  const updated: WorkflowRun = { ...previous.data, status: 'superseded', history: [...previous.data.history, { nodeId: waiting?.nodeId ?? previous.data.history.at(-1)?.nodeId ?? 'run', kind: 'supersede', state: 'superseded', at: new Date().toISOString(), detail: 'SUPERSEDED' } satisfies RunEvent] };
  delete updated.waiting;
  await store.workerWrite(tenantId, 'run', previous.id, previous.version, 'superseded', updated);
  if (waiting) await scheduler.raise(runId, 'approval', { bindingDigest: waiting.bindingDigest, decision: 'cancel' });
}

export async function supersedePrevious(store: WorkflowStore, scheduler: Scheduler, tenantId: string, definitionId: string, run: WorkflowRun): Promise<void> {
  if (run.subject === undefined) return;
  const previousId = await claimHead(store, tenantId, definitionId, run);
  if (previousId !== undefined && previousId !== run.id) await supersede(store, scheduler, tenantId, previousId);
}
