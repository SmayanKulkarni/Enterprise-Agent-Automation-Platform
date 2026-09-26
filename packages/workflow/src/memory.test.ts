import { expect, test } from 'vitest';
import { memoryFingerprint, memoryItemId, validateMemoryProposal } from './memory.js';
import type { WorkflowRun } from './service.js';

const run: WorkflowRun = { id: '11111111-1111-4111-8111-111111111111', tenantId: '22222222-2222-4222-8222-222222222222', ownerId: '33333333-3333-4333-8333-333333333333', stableDefinitionId: '44444444-4444-4444-8444-444444444444', definitionId: '55555555-5555-4555-8555-555555555555', definitionRevision: 1, definitionDigest: 'a'.repeat(64), inputDigest: 'b'.repeat(64), input: { statement: 'Use email only.' }, status: 'completed', history: [], outputs: {} };

test('admits exact redaction-safe proposals with deterministic identity', async () => {
  const proposal = { type: 'stated-preference', text: 'Use email only.', sourceId: `input:${run.id}`, sourceDigest: run.inputDigest, excerpt: 'Use email only.', subject: run.ownerId };
  const accepted = await validateMemoryProposal(proposal, run);
  expect(accepted?.proposal).toMatchObject(proposal);
  if (!accepted) throw new Error('Proposal was not accepted.');
  const fingerprint = await memoryFingerprint({ tenantId: run.tenantId, stableDefinitionId: run.stableDefinitionId }, accepted.proposal);
  expect(memoryItemId(fingerprint)).toBe(memoryItemId(fingerprint));
  await expect(validateMemoryProposal({ ...proposal, text: 'token=secret' }, run)).resolves.toBeUndefined();
  await expect(validateMemoryProposal({ ...proposal, sourceDigest: 'c'.repeat(64) }, run)).resolves.toBeUndefined();
});
