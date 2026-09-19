import { canonicalJson, digest } from '../../contracts/src/index.js';
import type { PackageArtifact, PackageDraft } from './index.js';

export interface StudioBudget { tokens: number; milliseconds: number; attempts: number; cost: number; }
export interface AgentDefinition {
  id: string; version: string; goal: string; inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown>; instructions: string;
  modelPolicy: { primary: string; fallback?: string }; capabilities: string[]; knowledgeScopes: string[]; memoryScopes: string[]; stageLimits: string[];
  delegation: { targets: string[]; maxDepth: number }; budgets: StudioBudget; guardrailHooks: string[]; failureBehavior: 'stop' | 'escalate' | 'retry'; requiredEvaluations: string[]; provenance: string; documentation: string;
}
export interface AgentTeam { members: string[]; orchestratorId: string; delegation: { from: string; to: string }[]; join: 'all' | 'any' | 'quorum'; cancellation: 'cancel-pending' | 'continue'; conflict: 'escalate' | 'first-wins'; budgets: StudioBudget; }
export interface WorkflowDefinition { stages: { id: string; agentId: string; transitions: string[] }[]; interventions: string[]; }
export interface EvaluationDefinition { id: string; cases: string[]; datasetRef: string; rubricRef: string; threshold: number; hardChecks: string[]; }
export interface StudioDraft {
  id: string; version: string; author: string; package: { name: string; provenance: string; bindings: string[] }; allowedCapabilities: string[];
  agents: AgentDefinition[]; team: AgentTeam; workflow: WorkflowDefinition; evaluations: EvaluationDefinition[];
  dependencies: { id: string; version: string; digest: string }[];
}
export interface StudioIssue { path: string; code: 'DUPLICATE_ID' | 'UNDECLARED_AGENT' | 'OUT_OF_TEAM_DELEGATION' | 'CYCLIC_DELEGATION' | 'UNKNOWN_CAPABILITY' | 'UNBOUNDED_BUDGET' | 'MISSING_EVALUATION' | 'INVALID_TRANSITION' | 'FORBIDDEN_CONTENT'; message: string; }
export interface StudioChange { category: 'instruction' | 'schema' | 'authority' | 'capability' | 'model' | 'budget' | 'memory' | 'delegation' | 'workflow' | 'evaluation' | 'dependency'; path: string; direction: 'changed' | 'widened' | 'narrowed'; before: unknown; after: unknown; }

const forbidden = /secret|token|password|executable|endpoint|tenant(?:Id|Data)?/iu;
const issue = (path: string, code: StudioIssue['code'], message: string): StudioIssue => ({ path, code, message });
const same = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);
const invalidContent = (value: unknown, path = ''): string | undefined => {
  if (Array.isArray(value)) return value.map((item, index) => invalidContent(item, `${path}/${index}`)).find((item): item is string => item !== undefined);
  if (value !== null && typeof value === 'object') for (const [key, child] of Object.entries(value)) { const childPath = `${path}/${key}`; if (key !== 'tokens' && forbidden.test(key)) return childPath; const nested = invalidContent(child, childPath); if (nested !== undefined) return nested; }
  return undefined;
};
const containsCycle = (edges: readonly { from: string; to: string }[]): boolean => {
  const graph = new Map<string, string[]>(); for (const edge of edges) graph.set(edge.from, [...(graph.get(edge.from) ?? []), edge.to]);
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (node: string): boolean => { if (visiting.has(node)) return true; if (visited.has(node)) return false; visiting.add(node); const cyclic = (graph.get(node) ?? []).some(visit); visiting.delete(node); visited.add(node); return cyclic; };
  return [...graph.keys()].some(visit);
};
const validateBudget = (budget: StudioBudget, path: string, issues: StudioIssue[]): void => {
  for (const [name, value] of Object.entries(budget)) if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value) && name !== 'cost') issues.push(issue(`${path}/${name}`, 'UNBOUNDED_BUDGET', 'Budgets must be finite, non-negative bounds.'));
};

export function validateStudioDraft(draft: StudioDraft): readonly StudioIssue[] {
  const issues: StudioIssue[] = []; const unsafe = invalidContent(draft); if (unsafe !== undefined) issues.push(issue(unsafe, 'FORBIDDEN_CONTENT', 'Reusable package content cannot include this field.'));
  const agentIds = new Set<string>();
  draft.agents.forEach((agent, index) => { if (agentIds.has(agent.id)) issues.push(issue(`/agents/${index}/id`, 'DUPLICATE_ID', 'Agent IDs must be unique.')); agentIds.add(agent.id); validateBudget(agent.budgets, `/agents/${index}/budgets`, issues); if (!Number.isSafeInteger(agent.delegation.maxDepth) || agent.delegation.maxDepth < 0) issues.push(issue(`/agents/${index}/delegation/maxDepth`, 'UNBOUNDED_BUDGET', 'Delegation depth must be bounded.')); agent.capabilities.forEach((capability, capabilityIndex) => { if (!draft.allowedCapabilities.includes(capability)) issues.push(issue(`/agents/${index}/capabilities/${capabilityIndex}`, 'UNKNOWN_CAPABILITY', 'Capability is not declared by the package.')); }); });
  const evaluationIds = new Set(draft.evaluations.map((evaluation) => evaluation.id));
  draft.agents.forEach((agent, index) => agent.requiredEvaluations.forEach((evaluation, evaluationIndex) => { if (!evaluationIds.has(evaluation)) issues.push(issue(`/agents/${index}/requiredEvaluations/${evaluationIndex}`, 'MISSING_EVALUATION', 'Required evaluation is not declared.')); }));
  const members = new Set(draft.team.members); if (!members.has(draft.team.orchestratorId) || !agentIds.has(draft.team.orchestratorId)) issues.push(issue('/team/orchestratorId', 'UNDECLARED_AGENT', 'The Orchestrator must be a declared team member.')); validateBudget(draft.team.budgets, '/team/budgets', issues);
  draft.team.delegation.forEach((edge, index) => { if (!members.has(edge.from)) issues.push(issue(`/team/delegation/${index}/from`, 'OUT_OF_TEAM_DELEGATION', 'Delegation source is outside the team.')); if (!members.has(edge.to)) issues.push(issue(`/team/delegation/${index}/to`, 'OUT_OF_TEAM_DELEGATION', 'Delegation target is outside the team.')); });
  if (containsCycle(draft.team.delegation)) issues.push(issue('/team/delegation', 'CYCLIC_DELEGATION', 'Team delegation must be acyclic.'));
  const stages = new Set(draft.workflow.stages.map((stage) => stage.id));
  draft.workflow.stages.forEach((stage, stageIndex) => stage.transitions.forEach((transition, transitionIndex) => { if (!stages.has(transition)) issues.push(issue(`/workflow/stages/${stageIndex}/transitions/${transitionIndex}`, 'INVALID_TRANSITION', 'Workflow transition is not declared.')); }));
  return Object.freeze(issues.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code)));
}

const change = (category: StudioChange['category'], path: string, before: unknown, after: unknown, direction: StudioChange['direction'] = 'changed'): StudioChange => ({ category, path, direction, before, after });
const named = <Value extends { id: string }>(values: readonly Value[]): ReadonlyMap<string, Value> => new Map(values.map((value) => [value.id, value]));

export function diffStudioDrafts(before: StudioDraft, after: StudioDraft): readonly StudioChange[] {
  const changes: StudioChange[] = [];
  const agentsBefore = named(before.agents); const agentsAfter = named(after.agents);
  for (const id of [...new Set([...agentsBefore.keys(), ...agentsAfter.keys()])].sort()) {
    const left = agentsBefore.get(id); const right = agentsAfter.get(id); if (left === undefined || right === undefined) { changes.push(change('authority', `/agents/${id}`, left, right, left === undefined ? 'widened' : 'narrowed')); continue; }
    const fields: readonly [StudioChange['category'], keyof AgentDefinition][] = [['instruction', 'instructions'], ['schema', 'inputSchema'], ['schema', 'outputSchema'], ['model', 'modelPolicy'], ['capability', 'capabilities'], ['memory', 'knowledgeScopes'], ['memory', 'memoryScopes'], ['delegation', 'delegation'], ['evaluation', 'requiredEvaluations']];
    for (const [category, field] of fields) if (!same(left[field], right[field])) { const prior = left[field]; const next = right[field]; const widening = Array.isArray(prior) && Array.isArray(next) ? next.some((value) => (prior as readonly unknown[]).includes(value)) : false; changes.push(change(category, `/agents/${id}/${field}`, prior, next, widening ? 'widened' : 'changed')); }
    for (const field of Object.keys(left.budgets) as (keyof StudioBudget)[]) if (left.budgets[field] !== right.budgets[field]) changes.push(change('budget', `/agents/${id}/budgets/${field}`, left.budgets[field], right.budgets[field], right.budgets[field] > left.budgets[field] ? 'widened' : 'narrowed'));
  }
  const fields: readonly [StudioChange['category'], keyof Pick<StudioDraft, 'team' | 'workflow' | 'evaluations' | 'dependencies'>][] = [['delegation', 'team'], ['workflow', 'workflow'], ['evaluation', 'evaluations'], ['dependency', 'dependencies']];
  for (const [category, field] of fields) if (!same(before[field], after[field])) changes.push(change(category, `/${field}`, before[field], after[field]));
  return Object.freeze(changes.sort((left, right) => left.path.localeCompare(right.path)));
}

export async function assemblePackage(draft: StudioDraft): Promise<PackageDraft> {
  const issues = validateStudioDraft(draft); if (issues.length) throw new Error(`INVALID_STUDIO_DRAFT:${issues[0]?.code ?? 'UNKNOWN'}`);
  const create = async (id: string, kind: PackageArtifact['kind'], content: Record<string, unknown>): Promise<PackageArtifact> => ({ id, version: draft.version, kind, content, digest: await digest(content) });
  const artifacts = await Promise.all([
    ...draft.agents.map((agent) => create(agent.id, 'agent', agent as unknown as Record<string, unknown>)),
    create('agent-team-workflow', 'workflow', { team: draft.team, workflow: draft.workflow }),
    create('evaluations', 'evaluation', { evaluations: draft.evaluations }),
    create('documentation', 'documentation', { package: draft.package, provenance: draft.package.provenance }),
  ]);
  return Object.freeze({ id: draft.id, version: draft.version, author: draft.author, artifacts: Object.freeze(artifacts), dependencies: Object.freeze([...draft.dependencies].sort((left, right) => left.id.localeCompare(right.id))), bindings: Object.freeze([...new Set(draft.package.bindings)].sort()), overlayPaths: Object.freeze([]) });
}
