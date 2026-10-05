import { expect, test } from 'vitest';
import { TENANT, awaitingApproval, contextFor, idle, readRun, unusedModel, worker } from './worker-harness.test-support.js';

const ADMIN = '55555555-5555-4555-8555-555555555555';
const STARTER = '66666666-6666-4666-8666-666666666666';
const OTHER = '77777777-7777-4777-8777-777777777777';
const RUN = '88888888-8888-4888-8888-888888888888';
const waiting = () => awaitingApproval(RUN, STARTER);

const decide = async (setup: Awaited<ReturnType<typeof awaitingApproval>>, decision: 'approve' | 'reject', reason?: string) => {
  const run = await readRun(setup.records, RUN);
  await setup.service.approve(contextFor(ADMIN), RUN, run.data.waiting!.bindingDigest, decision, run.version, `99999999-9999-4999-8999-${decision === 'approve' ? '000000000001' : '000000000002'}`, 'digest', reason);
  return (await readRun(setup.records, RUN)).data;
};

test('a reject ends the run as rejected with a decision record that keeps what the approver saw', async () => {
  const setup = await waiting();
  const run = await decide(setup, 'reject', 'wrong branch');
  expect(run.status).toBe('rejected');
  expect(run.waiting).toBeUndefined();
  expect(run.decisions?.['gate']).toMatchObject({ outcome: 'reject', reason: 'wrong branch', approverId: ADMIN, facts: [{ name: 'title', value: 'PR 7' }] });
  expect(run.history.at(-1)).toMatchObject({ kind: 'approval', state: 'rejected', detail: 'reject' });
  expect(setup.raised).toHaveLength(1);
});

test('an approve keeps the run going and records the decision', async () => {
  const run = await decide(await waiting(), 'approve');
  expect(run.status).toBe('running');
  expect(run.decisions?.['gate']).toMatchObject({ outcome: 'approve', approverId: ADMIN });
});

test.each([['a reason over 1000 characters', 'x'.repeat(1001)], ['a non-text reason', 5 as unknown as string]])('approve refuses %s', async (_label, reason) => {
  const setup = await waiting();
  await expect(decide(setup, 'reject', reason)).rejects.toMatchObject({ code: 'INVALID' });
});

test('an expired approval ends as expired, not failed', async () => {
  const { records } = await waiting();
  await worker(records, unusedModel, idle).expire(TENANT, RUN, 'gate');
  const run = (await readRun(records, RUN)).data;
  expect(run.status).toBe('expired');
  expect(run.history.at(-1)).toMatchObject({ state: 'expired', detail: 'APPROVAL_EXPIRED' });
});

test('the starter can cancel a waiting run and the scheduler is told', async () => {
  const setup = await waiting();
  const run = await readRun(setup.records, RUN);
  await setup.service.cancel(contextFor(STARTER), RUN, run.version, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'digest');
  const cancelled = (await readRun(setup.records, RUN)).data;
  expect(cancelled.status).toBe('cancelled');
  expect(cancelled.history.at(-1)).toMatchObject({ state: 'cancelled', detail: 'CANCELLED' });
  expect(setup.raised).toHaveLength(1);
  const next = await worker(setup.records, unusedModel, idle).step(TENANT, RUN, setup.definition.id, 'gate');
  expect(next).toEqual({ failed: true });
});

test('someone who did not start the run cannot cancel it unless they are an admin', async () => {
  const setup = await waiting();
  setup.records.profiles.set(OTHER, ['operator']); setup.records.profiles.set(ADMIN, ['admin', 'operator']);
  const run = await readRun(setup.records, RUN);
  await expect(setup.service.cancel(contextFor(OTHER), RUN, run.version, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'digest')).rejects.toMatchObject({ code: 'DENIED' });
  await setup.service.cancel(contextFor(ADMIN), RUN, run.version, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'digest');
  expect((await readRun(setup.records, RUN)).data.status).toBe('cancelled');
});

test('a finished run cannot be cancelled', async () => {
  const setup = await waiting();
  await decide(setup, 'reject');
  const run = await readRun(setup.records, RUN);
  await expect(setup.service.cancel(contextFor(STARTER), RUN, run.version, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'digest')).rejects.toMatchObject({ code: 'STALE' });
});
