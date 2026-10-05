import { expect, test } from 'vitest';
import { checkMemoryProposal, claimsGrounded, ungroundedClaims, InMemoryHostedMemoryPort, memoryExpiry, memoryFingerprint, memoryFingerprintV2, memoryItemId, normalizeSubjects, proposalSource, toolSourceId, validateMemoryProposal } from './memory.js';
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

const hosted = (id: string, subjects: string[], text = id) => ({ id, text, metadata: { stableDefinitionId: 's', definitionId: 'd', producingRevision: 1, type: 'task-fact' as const, sourceId: 'x', sourceDigest: 'a'.repeat(64), state: 'promoted' as const, expiresAt: '2099-01-01T00:00:00.000Z', subjects } });

test('subject keys are lower-cased, validated, de-duplicated and capped at three', () => {
  expect(normalizeSubjects(['NPM:Zod', ' repo:acme/api ', 'pr:acme/api#42', 'npm:zod', 'bad key', '', 4, 'a', 'b', 'c'])).toEqual(['npm:zod', 'repo:acme/api', 'pr:acme/api#42']);
  expect(normalizeSubjects(undefined)).toEqual([]);
  expect(normalizeSubjects(['x'.repeat(81)])).toEqual([]);
});

test('claim grounding requires every number, id and quoted string to appear in the source', () => {
  const source = '{"advisories":1,"id":"GHSA-m95q-7qp3-xv42","downloads":"1200"}';
  expect(claimsGrounded('zod has 1 advisory GHSA-m95q-7qp3-xv42.', source)).toBe(true);
  expect(claimsGrounded('zod has 7 advisories', source)).toBe(false);
  expect(claimsGrounded('see GHSA-aaaa-bbbb-cccc', source)).toBe(false);
  expect(claimsGrounded('labelled "critical"', source)).toBe(false);
  expect(claimsGrounded('no claims here', source)).toBe(true);
});

test('v2 fingerprints ignore the source and run, but keep owners and subjects apart', async () => {
  const scope = { tenantId: run.tenantId, stableDefinitionId: run.stableDefinitionId };
  const base = await memoryFingerprintV2(scope, { type: 'task-fact', text: 'zod is safe', subjects: ['npm:zod', 'repo:a'] });
  expect(await memoryFingerprintV2(scope, { type: 'task-fact', text: ' zod  is safe ', subjects: ['repo:a', 'npm:zod'] })).toBe(base);
  expect(await memoryFingerprintV2(scope, { type: 'task-fact', text: 'zod is safe', subjects: ['npm:zod'] })).not.toBe(base);
  const ownerOne = await memoryFingerprintV2(scope, { type: 'stated-preference', text: 'email', subject: 'pref', subjects: [], ownerId: 'u1' });
  expect(await memoryFingerprintV2(scope, { type: 'stated-preference', text: 'email', subject: 'pref', subjects: [], ownerId: 'u2' })).not.toBe(ownerOne);
});

test('proposals can cite a tool result by call id and are grounded against its content', async () => {
  const withTool: WorkflowRun = { ...run, agents: { analyst: { transcript: [{ role: 'assistant', call: { id: 'c1', name: 't0_osv', arguments: {} } }, { role: 'tool', callId: 'c1', name: 't0_osv', content: '{"id":"GHSA-m95q-7qp3-xv42","open":1}' }], rounds: 1, effects: 0, tokens: 0, cost: 0 } } };
  const sourceId = toolSourceId(run.id, 'analyst', 'c1');
  const source = await proposalSource(withTool, sourceId);
  expect(source).toMatchObject({ kind: 'tool', text: '{"id":"GHSA-m95q-7qp3-xv42","open":1}' });
  const proposal = { type: 'task-fact', text: 'zod has 1 open advisory GHSA-m95q-7qp3-xv42', sourceId, sourceDigest: source?.digest, excerpt: 'GHSA-m95q-7qp3-xv42', subjects: ['NPM:zod'] };
  expect((await validateMemoryProposal(proposal, withTool))?.proposal).toMatchObject({ sourceId, subjects: ['npm:zod'] });
  expect(await checkMemoryProposal({ ...proposal, text: 'zod has 9 open advisories' }, withTool)).toEqual({ reason: 'UNGROUNDED_CLAIM' });
  expect(await proposalSource(withTool, toolSourceId(run.id, 'analyst', 'missing'))).toBeUndefined();
  expect(await proposalSource(withTool, toolSourceId(run.id, 'other', 'c1'))).toBeUndefined();
  expect(await checkMemoryProposal({ ...proposal, subjects: 'npm:zod' }, withTool)).toEqual({ reason: 'INVALID_ARGUMENTS' });
});

test('node outputs are citable only after the node completed with a non-empty output', async () => {
  const done: WorkflowRun = { ...run, history: [{ nodeId: 'analyst', kind: 'agent', state: 'completed', at: 'now' }], outputs: { analyst: { verdict: 'low risk' }, empty: {} } };
  const source = await proposalSource(done, `output:${run.id}:analyst`);
  expect(source).toMatchObject({ kind: 'output', text: '{"verdict":"low risk"}' });
  expect(await proposalSource(done, `output:${run.id}:empty`)).toBeUndefined();
  expect(await proposalSource({ ...done, history: [] }, `output:${run.id}:analyst`)).toBeUndefined();
});

test('the in-memory port filters on array membership and honours an injected scorer', async () => {
  const port = new InMemoryHostedMemoryPort([], (_query, text) => text === 'near' ? 0.9 : 0.1);
  await port.upsert('ns', hosted('a', ['npm:zod'], 'near')); await port.upsert('ns', hosted('b', ['npm:lodash'], 'far')); await port.upsert('ns', hosted('c', [], 'far'));
  expect((await port.query('ns', 'q', 5, { state: 'promoted', subjects: { contains: 'npm:zod' } })).map((match) => match.id)).toEqual(['a']);
  expect((await port.query('ns', 'q', 5, { state: 'promoted' })).map((match) => match.id)).toEqual(['a', 'b', 'c']);
});

test('expiry follows the item type', () => {
  const from = Date.parse('2026-01-01T00:00:00.000Z');
  expect(memoryExpiry('task-fact', from)).toBe('2026-04-01T00:00:00.000Z');
  expect(memoryExpiry('run-summary', from)).toBe('2026-01-31T00:00:00.000Z');
  expect(memoryExpiry('stated-preference', from)).toBe('2026-06-30T00:00:00.000Z');
});

test('an ISO timestamp is one claim and is grounded by the same timestamp in the source', () => {
  const source = '{"lastPublished":"2026-09-13T23:25:14.644Z","version":"4.6.5"}';
  expect(claimsGrounded('zod 4.6.5 last published 2026-09-13T23:25:14.644Z', source)).toBe(true);
  expect(claimsGrounded('zod last published 2026-09-13T23:25:14.999Z', source)).toBe(false);
});

test('ungroundedClaims names each number or id missing from the source', () => {
  expect(ungroundedClaims('zod 4.6.5 has 7 advisories GHSA-aaaa-bbbb', '{"version":"4.6.5","count":1}')).toEqual(['7', 'GHSA-aaaa-bbbb']);
  expect(ungroundedClaims('zod 4.6.5', '{"version":"4.6.5"}')).toEqual([]);
});
