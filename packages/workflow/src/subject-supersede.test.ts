import { createHmac } from 'node:crypto';
import { expect, test } from 'vitest';
import { deliverWebhook, type Scheduler } from './service.js';
import { validateGraph, type GraphDraft } from './graph.js';
import { DEFINITION, MemoryRecords, TENANT, WRITE_SPEC, asStore, install, mcpNode, pinFor, publish, readRun, shape, unusedModel, worker } from './worker-harness.test-support.js';

const SECRET = 'subject-secret';
const inputSchema = shape({ repo: { type: 'string' }, pr: { type: 'number' }, head: { type: 'string' }, title: { type: 'string' } });
const eventOf = (n: number) => `${String(n).padStart(8, '0')}-eeee-4eee-8eee-eeeeeeeeeeee`;

function setup(subject: Record<string, unknown> = { subjectKey: ['repo', 'pr'], subjectVersion: 'head' }, raiseFails = false) {
  const records = new MemoryRecords(); const pin = pinFor('act', WRITE_SPEC); install(records, [pin]);
  const definition = publish(records, [
    { id: 'trigger', kind: 'trigger', config: { mode: 'webhook', inputSchema, ...subject }, next: 'gate' },
    { id: 'gate', kind: 'approval', config: { timeoutMs: 60000 }, next: 'act' },
    mcpNode('act', WRITE_SPEC, { title: '$input.title' }, { next: 'end' }),
    { id: 'end', kind: 'end', config: {}, next: null },
  ], [pin]);
  const started: string[] = []; const raised: unknown[] = [];
  const scheduler: Scheduler = { start: async (runId) => { started.push(runId); }, raise: async (_run, _name, value) => { if (raiseFails) throw new Error('scheduler down'); raised.push(value); } };
  let sent = 0;
  const mcp = { invoke: async () => { sent += 1; return { outcome: 'succeeded' as const, output: { result: 'ok' } }; } };
  const deliver = async (n: number, body: Record<string, unknown>) => {
    const bytes = new TextEncoder().encode(JSON.stringify(body)); const timestamp = new Date().toISOString();
    const signature = `sha256=${createHmac('sha256', SECRET).update(Buffer.concat([Buffer.from(`${TENANT}:${DEFINITION}:${timestamp}:${eventOf(n)}:`), Buffer.from(bytes)])).digest('hex')}`;
    return deliverWebhook(asStore(records), scheduler, { tenantId: TENANT, definitionId: DEFINITION, eventId: eventOf(n), timestamp, signature, body: bytes, fallbackSecret: SECRET });
  };
  const toGate = async (runId: string) => { const w = worker(records, unusedModel, mcp); await w.step(TENANT, runId, definition.id, 'trigger'); await w.step(TENANT, runId, definition.id, 'gate'); };
  return { records, definition, deliver, toGate, raised, sent: () => sent, mcp, started };
}
const pr = (number: number, head: string) => ({ repo: 'o/r', pr: number, head, title: 'x' });

test('a newer event for the same subject supersedes the run still waiting for approval', async () => {
  const { records, deliver, toGate, raised } = setup();
  const first = await deliver(1, pr(7, 'aaa')); await toGate(first.runId!);
  expect((await readRun(records, first.runId!)).data.status).toBe('waiting-approval');
  const second = await deliver(2, pr(7, 'bbb'));
  const old = (await readRun(records, first.runId!)).data;
  expect(old.status).toBe('superseded');
  expect(old.history.at(-1)).toMatchObject({ state: 'superseded', detail: 'SUPERSEDED' });
  expect(old.waiting).toBeUndefined();
  expect((await readRun(records, second.runId!)).data.status).toBe('queued');
  expect(raised).toHaveLength(1);
});

test('a failure while superseding the old run never stops the new run from starting', async () => {
  const { records, deliver, toGate, started } = setup(undefined, true);
  const first = await deliver(1, pr(7, 'aaa')); const firstId = first.runId ?? ''; await toGate(firstId);
  const second = await deliver(2, pr(7, 'bbb'));
  expect(second.outcome).toBe('accepted');
  expect(started).toContain(second.runId);
  expect((await readRun(records, firstId)).data.status).toBe('superseded');
});

test('a different subject is left alone', async () => {
  const { records, deliver, toGate } = setup();
  const first = await deliver(1, pr(7, 'aaa')); await toGate(first.runId!);
  await deliver(2, pr(8, 'aaa'));
  expect((await readRun(records, first.runId!)).data.status).toBe('waiting-approval');
});

test('replaying the same event does not supersede anything', async () => {
  const { records, deliver, toGate } = setup();
  const first = await deliver(1, pr(7, 'aaa')); await toGate(first.runId!);
  await deliver(1, pr(7, 'aaa'));
  expect((await readRun(records, first.runId!)).data.status).toBe('waiting-approval');
});

test('without a subject nothing is superseded', async () => {
  const { records, deliver, toGate } = setup({});
  const first = await deliver(1, pr(7, 'aaa')); await toGate(first.runId!);
  await deliver(2, pr(7, 'bbb'));
  expect((await readRun(records, first.runId!)).data.status).toBe('waiting-approval');
});

test('an effect is refused if its run is no longer the head for its subject', async () => {
  const { records, definition, deliver, mcp, sent } = setup();
  const first = await deliver(1, pr(7, 'aaa'));
  await deliver(2, pr(7, 'bbb'));
  const stale = await readRun(records, first.runId!);
  await records.workerWrite(TENANT, 'run', stale.id, stale.version, 'running', { ...stale.data, status: 'running' });
  await worker(records, unusedModel, mcp).step(TENANT, first.runId!, definition.id, 'act');
  expect((await readRun(records, first.runId!)).data.status).toBe('superseded');
  expect(sent()).toBe(0);
});

const draft = (subject: Record<string, unknown>, mode = 'webhook'): GraphDraft => ({ kind: 'graph-v1', nodes: [
  { id: 'start', kind: 'trigger', title: 's', detail: '', x: 0, y: 0, instructions: '', config: { mode, inputSchema, ...subject } },
  { id: 'end', kind: 'end', title: 'e', detail: '', x: 0, y: 0, instructions: '', config: {} },
], edges: [{ id: 'a', from: 'start', to: 'end' }] });
const invalid = (subject: Record<string, unknown>, mode?: string): boolean => validateGraph(draft(subject, mode)).some((issue) => issue.code === 'INVALID_TRIGGER');

test.each([
  [{}, false],
  [{ subjectKey: ['repo', 'pr'], subjectVersion: 'head' }, false],
  [{ subjectKey: ['repo'] }, true],
  [{ subjectVersion: 'head' }, true],
  [{ subjectKey: [], subjectVersion: 'head' }, true],
  [{ subjectKey: ['missing'], subjectVersion: 'head' }, true],
  [{ subjectKey: ['repo'], subjectVersion: 'missing' }, true],
  [{ subjectKey: ['repo', 'repo'], subjectVersion: 'head' }, true],
])('subject config %j is invalid: %s', (subject, expected) => {
  expect(invalid(subject)).toBe(expected);
});

test('a subject needs a webhook trigger', () => {
  expect(invalid({ subjectKey: ['repo'], subjectVersion: 'head' }, 'manual')).toBe(true);
});
