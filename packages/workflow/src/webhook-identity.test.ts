import { createHmac } from 'node:crypto';
import { expect, test } from 'vitest';
import { deliverWebhook, type Scheduler } from './service.js';
import { ingressResponse } from './ingress-outcome.js';
import { DEFINITION, MemoryRecords, TENANT, asStore, publish, shape } from './worker-harness.test-support.js';

const OTHER_DEFINITION = '99999999-9999-4999-8999-999999999999';
const EVENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SECRET = 'shared-secret';

const setup = () => {
  const records = new MemoryRecords();
  const trigger = { id: 'trigger', kind: 'trigger' as const, config: { mode: 'webhook', inputSchema: shape({ pr: { type: 'number' } }) }, next: 'end' };
  const end = { id: 'end', kind: 'end' as const, config: {}, next: null };
  publish(records, [trigger, end], []);
  const second = publish(records, [trigger, end], [], 'trigger');
  records.published.set(`${TENANT}:${OTHER_DEFINITION}`, { ...records.published.get(`${TENANT}:${DEFINITION}`)!, id: OTHER_DEFINITION, definition: { ...second, id: OTHER_DEFINITION } });
  const started: string[] = [];
  const scheduler: Scheduler = { start: async (runId) => { started.push(runId); }, raise: async () => {} };
  const send = (body: Record<string, unknown>, definitionId = DEFINITION, eventId = EVENT) => {
    const bytes = new TextEncoder().encode(JSON.stringify(body)); const timestamp = new Date().toISOString();
    const signature = `sha256=${createHmac('sha256', SECRET).update(Buffer.concat([Buffer.from(`${TENANT}:${definitionId}:${timestamp}:${eventId}:`), Buffer.from(bytes)])).digest('hex')}`;
    return deliverWebhook(asStore(records), scheduler, { tenantId: TENANT, definitionId, eventId, timestamp, signature, body: bytes, fallbackSecret: SECRET });
  };
  return { records, started, send };
};

test('the run id is derived, not the event id, and the run is stored under it', async () => {
  const { records, started, send } = setup();
  const delivered = await send({ pr: 1 });
  expect(delivered.outcome).toBe('accepted');
  expect(delivered.runId).toBeDefined(); expect(delivered.runId).not.toBe(EVENT);
  expect((await records.workerRead(TENANT, 'run', delivered.runId!))?.state).toBe('queued');
  expect(await records.workerRead(TENANT, 'run', EVENT)).toBeUndefined();
  expect(started).toEqual([delivered.runId]);
});

test('the same event with the same payload replays to the original run and starts nothing twice', async () => {
  const { started, send } = setup();
  const first = await send({ pr: 1 });
  const again = await send({ pr: 1 });
  expect(again).toEqual({ outcome: 'replay', runId: first.runId });
  expect(started).toEqual([first.runId]);
});

test('the same event with a different payload is a conflict and creates no run', async () => {
  const { records, started, send } = setup();
  const first = await send({ pr: 1 });
  const clash = await send({ pr: 2 });
  expect(clash).toEqual({ outcome: 'conflict' });
  expect(started).toEqual([first.runId]);
  expect((await records.workerList(TENANT, 'run')).length).toBe(1);
});

test('the same event id sent to two definitions starts two independent runs', async () => {
  const { started, send } = setup();
  const one = await send({ pr: 1 }); const two = await send({ pr: 1 }, OTHER_DEFINITION);
  expect(one.outcome).toBe('accepted'); expect(two.outcome).toBe('accepted');
  expect(new Set([one.runId, two.runId]).size).toBe(2);
  expect(started).toHaveLength(2);
});

test.each([
  [{ outcome: 'accepted', runId: 'r1' }, 202, 'application/json', { runId: 'r1', status: 'queued' }],
  [{ outcome: 'replay', runId: 'r1' }, 202, 'application/json', { runId: 'r1', status: 'queued' }],
  [{ outcome: 'conflict' }, 422, 'application/problem+json', { status: 422, title: 'Event id reused with a different payload' }],
  [{ outcome: 'not-found' }, 404, 'application/problem+json', { status: 404 }],
  [{ outcome: 'invalid-shape' }, 400, 'application/problem+json', { status: 400 }],
  [{ outcome: 'signature' }, 403, 'application/problem+json', { status: 403 }],
  [{ outcome: 'freshness' }, 403, 'application/problem+json', { status: 403 }],
  [{ outcome: 'credential-state' }, 403, 'application/problem+json', { status: 403 }],
] as const)('ingress maps %j to %i', (delivery, status, contentType, body) => {
  const response = ingressResponse(delivery);
  expect(response).toMatchObject({ status, contentType, body });
});

test('unexpected failures become a 500 problem that leaks nothing', () => {
  const response = ingressResponse(undefined);
  expect(response.status).toBe(500);
  expect(response.contentType).toBe('application/problem+json');
});
