import { expect, test } from 'vitest';
import { awaitingApproval, contextFor, readRun } from './worker-harness.test-support.js';
import { validateGraph, type GraphDraft } from './graph.js';

const RUN = '88888888-8888-4888-8888-888888888888';
const STARTER = '66666666-6666-4666-8666-666666666666';
const REVIEWER = '55555555-5555-4555-8555-555555555555';

const approveAs = async (userId: string, gate: Record<string, unknown>) => {
  const setup = await awaitingApproval(RUN, STARTER, gate);
  const run = await readRun(setup.records, RUN);
  return setup.service.approve(contextFor(userId), RUN, run.data.waiting!.bindingDigest, 'approve', run.version, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'digest');
};

test('with separation of duties the person who started the run cannot approve it', async () => {
  await expect(approveAs(STARTER, { separationOfDuties: true })).rejects.toMatchObject({ code: 'DENIED' });
});

test('with separation of duties a different admin can approve', async () => {
  await expect(approveAs(REVIEWER, { separationOfDuties: true })).resolves.toBeUndefined();
});

test('without the flag the starter may still approve', async () => {
  await expect(approveAs(STARTER, {})).resolves.toBeUndefined();
});

test('the flag must be a boolean', () => {
  const draft = (value: unknown): GraphDraft => ({ kind: 'graph-v1', nodes: [{ id: 'gate', kind: 'approval', title: 'g', detail: '', x: 0, y: 0, instructions: '', config: { timeoutMs: 1000, separationOfDuties: value } }], edges: [] });
  expect(validateGraph(draft(true)).some((issue) => issue.code === 'INVALID_APPROVAL')).toBe(false);
  expect(validateGraph(draft('yes')).some((issue) => issue.code === 'INVALID_APPROVAL')).toBe(true);
});
