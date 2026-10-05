import { expect, test } from 'vitest';
import { projectApproval, type PendingApprovalRow } from './attention.js';

const digest = 'a'.repeat(64);
const row = (runLabel: string | null): PendingApprovalRow => ({ tenantId: 't1', workspace: 'w', runId: 'r1', runVersion: 3, definitionRevision: 2, workflowName: 'PR gate', runLabel, waitingKind: 'approval', waitingJson: JSON.stringify({ nodeId: 'gate', bindingDigest: digest, expiresAt: '2030-01-01T00:00:00.000Z', review: { capability: 'merge', installationId: 'i', target: 'repo', argumentsDigest: digest } }) });

test('a run label is carried to the approval and clipped', () => {
  expect(projectApproval(row('o/r#7 Fix'))?.runLabel).toBe('o/r#7 Fix');
  expect(projectApproval(row('x'.repeat(500)))?.runLabel).toHaveLength(120);
});

test('no label leaves the field out so the card falls back to the workflow name', () => {
  expect(projectApproval(row(null))).not.toHaveProperty('runLabel');
  expect(projectApproval(row('   '))).not.toHaveProperty('runLabel');
});
