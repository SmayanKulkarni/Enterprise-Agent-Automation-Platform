import { expect, test } from 'vitest';
import { evaluate, runChecks, simulate } from './studio-runs.js';
import type { StudioStoredDraft } from './studio-sql.js';

const revision = (): StudioStoredDraft => ({
  id: '22222222-2222-4222-8222-222222222222', tenantId: '11111111-1111-4111-8111-111111111111', revision: 1, state: 'draft', digest: 'a'.repeat(64), author: '33333333-3333-4333-8333-333333333333', createdAt: '2026-09-18T00:00:00.000Z',
  draft: { id: 'package', version: '1.0.0', author: 'author', package: { name: 'Package', provenance: 'docs/provenance.md', bindings: [] }, allowedCapabilities: ['sql.validate'], dependencies: [],
    agents: [{ id: 'orchestrator', version: '1.0.0', goal: 'Coordinate.', inputSchema: {}, outputSchema: {}, instructions: 'Coordinate.', modelPolicy: { primary: 'model' }, capabilities: ['sql.validate'], knowledgeScopes: ['package'], memoryScopes: ['case'], stageLimits: ['start'], delegation: { targets: [], maxDepth: 0 }, budgets: { tokens: 1, milliseconds: 1, attempts: 1, cost: 1 }, guardrailHooks: [], failureBehavior: 'stop', requiredEvaluations: ['required'], provenance: 'docs/provenance.md', documentation: 'docs/agent.md' }],
    team: { members: ['orchestrator'], orchestratorId: 'orchestrator', delegation: [], join: 'all', cancellation: 'cancel-pending', conflict: 'escalate', budgets: { tokens: 1, milliseconds: 1, attempts: 1, cost: 1 } }, workflow: { stages: [{ id: 'start', agentId: 'orchestrator', transitions: [] }], interventions: [] }, evaluations: [{ id: 'required', cases: ['case'], datasetRef: 'dataset', rubricRef: 'rubric', threshold: 1, hardChecks: ['schema'] }] },
});

test('runs exact-revision checks and blocks a fixture evaluation from release', async () => {
  const draft = revision();
  await expect(runChecks(draft)).resolves.toMatchObject({ subjectDigest: draft.digest, status: 'passed', classification: 'unverified' });
  await expect(simulate(draft, 'fixture-1')).resolves.toMatchObject({ status: 'passed', classification: 'fixture' });
  await expect(evaluate(draft, 'suite-1')).resolves.toMatchObject({ status: 'blocked', reasonCodes: ['live-certification'] });
});

test('reports budget exhaustion as a failed fixture result', async () => {
  const draft = revision(); draft.draft.team = { ...draft.draft.team, budgets: { ...draft.draft.team.budgets, tokens: 0 } };
  await expect(simulate(draft, 'fixture-1')).resolves.toMatchObject({ status: 'failed', reasonCodes: ['BUDGET_EXHAUSTED'] });
});
