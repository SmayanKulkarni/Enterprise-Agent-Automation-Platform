import { describe, expect, it } from 'vitest';
import { SolutionLifecycle } from './index.js';
import { assemblePackage, diffStudioDrafts, validateStudioDraft, type StudioDraft } from './studio.js';

const draft = (): StudioDraft => ({
  id: 'technical-implementation',
  version: '1.0.0',
  author: 'author-1',
  package: { name: 'Technical Implementation', provenance: 'packages/lifecycle/src/studio.test.ts', bindings: ['sql-installation'] },
  allowedCapabilities: ['sql.validate', 'blob.write'],
  agents: [{
    id: 'orchestrator', version: '1.0.0', goal: 'Coordinate the implementation.', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, instructions: 'Plan bounded work.',
    modelPolicy: { primary: 'model-a', fallback: 'model-b' }, capabilities: ['sql.validate'], knowledgeScopes: ['package'], memoryScopes: ['case'], stageLimits: ['plan'],
    delegation: { targets: ['worker'], maxDepth: 1 }, budgets: { tokens: 1000, milliseconds: 1000, attempts: 2, cost: 1 }, guardrailHooks: ['policy'], failureBehavior: 'escalate', requiredEvaluations: ['quality'], provenance: 'packages/lifecycle/src/studio.test.ts', documentation: 'packages/lifecycle/src/index.ts',
  }, {
    id: 'worker', version: '1.0.0', goal: 'Validate data.', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, instructions: 'Validate only.',
    modelPolicy: { primary: 'model-a' }, capabilities: ['blob.write'], knowledgeScopes: ['package'], memoryScopes: ['case'], stageLimits: ['validate'],
    delegation: { targets: [], maxDepth: 0 }, budgets: { tokens: 100, milliseconds: 1000, attempts: 1, cost: 1 }, guardrailHooks: ['policy'], failureBehavior: 'stop', requiredEvaluations: ['quality'], provenance: 'packages/lifecycle/src/studio.test.ts', documentation: 'packages/lifecycle/src/index.ts',
  }],
  team: { members: ['orchestrator', 'worker'], orchestratorId: 'orchestrator', delegation: [{ from: 'orchestrator', to: 'worker' }], join: 'all', cancellation: 'cancel-pending', conflict: 'escalate', budgets: { tokens: 1100, milliseconds: 2000, attempts: 3, cost: 2 } },
  workflow: { stages: [{ id: 'plan', agentId: 'orchestrator', transitions: ['validate'] }, { id: 'validate', agentId: 'worker', transitions: [] }], interventions: ['missing-information'] },
  evaluations: [{ id: 'quality', cases: ['case-1'], datasetRef: 'dataset-v1', rubricRef: 'rubric-v1', threshold: 0.8, hardChecks: ['schema'] }],
  dependencies: [],
});

describe('Solution Studio authoring contract', () => {
  it('reports malformed drafts at their semantic paths', () => {
    const duplicate = draft(); duplicate.agents = [...duplicate.agents, { ...duplicate.agents[1]! }];
    expect(validateStudioDraft(duplicate)).toContainEqual(expect.objectContaining({ path: '/agents/2/id', code: 'DUPLICATE_ID' }));

    const noOrchestrator = draft(); noOrchestrator.team = { ...noOrchestrator.team, orchestratorId: 'missing' };
    expect(validateStudioDraft(noOrchestrator)).toContainEqual(expect.objectContaining({ path: '/team/orchestratorId', code: 'UNDECLARED_AGENT' }));

    const escapedDelegation = draft(); escapedDelegation.team = { ...escapedDelegation.team, delegation: [{ from: 'orchestrator', to: 'outside' }] };
    expect(validateStudioDraft(escapedDelegation)).toContainEqual(expect.objectContaining({ path: '/team/delegation/0/to', code: 'OUT_OF_TEAM_DELEGATION' }));

    const cyclic = draft(); cyclic.team = { ...cyclic.team, delegation: [...cyclic.team.delegation, { from: 'worker', to: 'orchestrator' }] };
    expect(validateStudioDraft(cyclic)).toContainEqual(expect.objectContaining({ path: '/team/delegation', code: 'CYCLIC_DELEGATION' }));

    const unknownCapability = draft(); unknownCapability.agents[0] = { ...unknownCapability.agents[0]!, capabilities: ['unknown'] };
    expect(validateStudioDraft(unknownCapability)).toContainEqual(expect.objectContaining({ path: '/agents/0/capabilities/0', code: 'UNKNOWN_CAPABILITY' }));

    const unbounded = draft(); unbounded.agents[0] = { ...unbounded.agents[0]!, budgets: { ...unbounded.agents[0]!.budgets, tokens: Infinity } };
    expect(validateStudioDraft(unbounded)).toContainEqual(expect.objectContaining({ path: '/agents/0/budgets/tokens', code: 'UNBOUNDED_BUDGET' }));

    const missingEvaluation = draft(); missingEvaluation.agents[0] = { ...missingEvaluation.agents[0]!, requiredEvaluations: ['missing'] };
    expect(validateStudioDraft(missingEvaluation)).toContainEqual(expect.objectContaining({ path: '/agents/0/requiredEvaluations/0', code: 'MISSING_EVALUATION' }));

    const invalidTransition = draft(); invalidTransition.workflow = { ...invalidTransition.workflow, stages: [{ ...invalidTransition.workflow.stages[0]!, transitions: ['missing'] }, draft().workflow.stages[1]!] };
    expect(validateStudioDraft(invalidTransition)).toContainEqual(expect.objectContaining({ path: '/workflow/stages/0/transitions/0', code: 'INVALID_TRANSITION' }));

    const unsafe = draft() as StudioDraft & { secret: string }; unsafe.secret = 'nope';
    expect(validateStudioDraft(unsafe)).toContainEqual(expect.objectContaining({ path: '/secret', code: 'FORBIDDEN_CONTENT' }));
  });

  it('reports deterministic semantic widening and creates canonical lifecycle artifacts', async () => {
    const before = draft();
    const after = draft(); after.agents[0] = { ...after.agents[0]!, capabilities: ['sql.validate', 'blob.write'], budgets: { ...after.agents[0]!.budgets, tokens: 2000 } };
    expect(diffStudioDrafts(before, after)).toEqual([
      expect.objectContaining({ category: 'budget', path: '/agents/orchestrator/budgets/tokens', direction: 'widened' }),
      expect.objectContaining({ category: 'capability', path: '/agents/orchestrator/capabilities', direction: 'widened' }),
    ]);

    const assembled = await assemblePackage(before);
    expect(assembled).toMatchObject({ id: 'technical-implementation', version: '1.0.0', author: 'author-1', bindings: ['sql-installation'] });
    expect(assembled.artifacts.map((artifact) => artifact.kind)).toEqual(['agent', 'agent', 'workflow', 'evaluation', 'documentation']);
    expect(assembled.artifacts.every((artifact) => /^[a-f0-9]{64}$/u.test(artifact.digest))).toBe(true);
    await expect(new SolutionLifecycle().authorStudio(before)).resolves.toMatchObject({ id: 'technical-implementation', version: '1.0.0' });
  });
});
