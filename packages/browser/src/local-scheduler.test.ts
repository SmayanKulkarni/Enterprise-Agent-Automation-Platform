import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { StepResult, WorkflowWorker } from '../../workflow/src/runtime.js';
import { APPROVAL_MAX_TIMEOUT_MS } from '../../workflow/src/timers.js';
import { localScheduler, recoverLocalRuns } from './local-scheduler.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const DEFINITION = '22222222-2222-4222-8222-222222222222';
const DIGEST = 'd'.repeat(64);
const store = { workerDefinition: async () => ({ definition: { start: 'gate' } }) } as never;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

interface Script { steps: Record<string, StepResult | StepResult[]>; log: string[]; expire?: StepResult; step?: () => Promise<StepResult>; }

const stubWorker = ({ steps, log, expire, step }: Script): WorkflowWorker => ({
  step: step ?? (async (_tenant: string, _run: string, _definition: string, nodeId: string) => { log.push(`step:${nodeId}`); const planned = steps[nodeId]; return (Array.isArray(planned) ? planned.shift() : planned) ?? { failed: true }; }),
  expire: async (_tenant: string, _run: string, nodeId: string) => { log.push(`expire:${nodeId}`); return expire ?? { failed: true }; },
  finalize: async () => { log.push('finalize'); },
  summarize: () => { log.push('summarize'); return Promise.resolve(); }, summaryFailed: () => Promise.resolve(), promote: () => { log.push('promote'); return Promise.resolve(); },
}) as unknown as WorkflowWorker;

const waitingAt = (deadlineOffsetMs: number): StepResult => ({ waiting: 'approval', deadline: new Date(Date.now() + deadlineOffsetMs).toISOString(), bindingDigest: DIGEST });
const settle = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(0); };

test('an approve decision continues to the next node and the run is finalized once it ends', async () => {
  const log: string[] = [];
  const scheduler = localScheduler(stubWorker({ steps: { gate: [waitingAt(60000), { next: 'act' }], act: { completed: true } }, log }), store);
  await scheduler.start('run-1', TENANT, DEFINITION); await settle();
  await scheduler.raise('run-1', 'approval', { bindingDigest: DIGEST, decision: 'approve' }); await settle();
  expect(log).toEqual(['step:gate', 'step:gate', 'step:act', 'finalize', 'summarize', 'promote']);
});

test('a completed run is finalized before its slow best-effort memory summary starts', async () => {
  const log: string[] = [];
  const scheduler = localScheduler(stubWorker({ steps: { gate: { completed: true } }, log }), store);
  await scheduler.start('run-1', TENANT, DEFINITION); await settle();
  expect(log.indexOf('finalize')).toBeLessThan(log.indexOf('summarize'));
  expect(log.filter((entry) => entry === 'finalize')).toHaveLength(1);
});

test.each(['reject', 'cancel'])('a %s decision ends the run and finalizes exactly once', async (decision) => {
  const log: string[] = [];
  const scheduler = localScheduler(stubWorker({ steps: { gate: waitingAt(60000) }, log }), store);
  await scheduler.start('run-1', TENANT, DEFINITION); await settle();
  await scheduler.raise('run-1', 'approval', { bindingDigest: DIGEST, decision }); await settle();
  expect(log).toEqual(['step:gate', 'finalize']);
});

test('a decision for a different binding is ignored and the run keeps waiting', async () => {
  const log: string[] = [];
  const scheduler = localScheduler(stubWorker({ steps: { gate: waitingAt(60000) }, log }), store);
  await scheduler.start('run-1', TENANT, DEFINITION); await settle();
  await scheduler.raise('run-1', 'approval', { bindingDigest: 'e'.repeat(64), decision: 'approve' }); await settle();
  expect(log).not.toContain('finalize');
  expect(log.filter((entry) => entry === 'step:gate').length).toBeGreaterThanOrEqual(2);
});

test('reaching the deadline expires the wait and then finalizes', async () => {
  const log: string[] = [];
  const scheduler = localScheduler(stubWorker({ steps: { gate: waitingAt(60000) }, log, expire: { failed: true } }), store);
  await scheduler.start('run-1', TENANT, DEFINITION); await settle();
  await vi.advanceTimersByTimeAsync(60001);
  expect(log).toEqual(['step:gate', 'expire:gate', 'finalize']);
});

test('the longest approval wait fits in a single timer delay', () => {
  expect(APPROVAL_MAX_TIMEOUT_MS).toBeLessThan(2 ** 31 - 1);
});

test('recovery restarts runs that were in flight when the server stopped and leaves finished runs alone', async () => {
  const record = (id: string, state: string) => ({ id, kind: 'run', version: 1, state, data: { definitionId: DEFINITION } });
  const store = { workerList: () => Promise.resolve([record('run-a', 'running'), record('run-b', 'waiting-approval'), record('run-c', 'waiting-connector'), record('run-d', 'completed'), record('run-e', 'failed'), record('run-f', 'rejected')]) };
  const started: string[] = [];
  const scheduler = { start: (runId: string, tenantId: string, definitionId: string) => { started.push(`${runId}:${tenantId}:${definitionId}`); return Promise.resolve(); }, raise: () => Promise.resolve() };
  expect(await recoverLocalRuns(store as never, scheduler, [TENANT])).toBe(3);
  expect(started).toEqual([`run-a:${TENANT}:${DEFINITION}`, `run-b:${TENANT}:${DEFINITION}`, `run-c:${TENANT}:${DEFINITION}`]);
});

test('a step that loses a concurrent write is retried instead of abandoning the run', async () => {
  const log: string[] = [];
  const stale = Object.assign(new Error('STALE'), { code: 'STALE' });
  let attempts = 0;
  const step = (): Promise<StepResult> => { attempts += 1; log.push('step:gate'); return attempts === 1 ? Promise.reject(stale) : Promise.resolve({ completed: true }); };
  await localScheduler(stubWorker({ steps: {}, log, step }), store).start('run-1', TENANT, DEFINITION); await settle();
  await vi.advanceTimersByTimeAsync(2000);
  expect(log).toEqual(['step:gate', 'step:gate', 'finalize', 'summarize', 'promote']);
});
