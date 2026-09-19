import { digest } from '../../contracts/src/index.js';
import { EvaluationLedger, GateCalculator } from '../../memory/src/index.js';
import { assemblePackage, validateStudioDraft } from './studio.js';
import type { StudioStoredDraft } from './studio-sql.js';

export interface StudioReport { subjectDigest: string; engine: string; engineVersion: '1.0.0'; environment: 'local'; classification: 'fixture' | 'unverified' | 'live'; startedAt: string; completedAt: string; status: 'passed' | 'failed' | 'blocked' | 'inconclusive'; evidenceIds: readonly string[]; reasonCodes: readonly string[]; }
export interface CheckReport extends StudioReport { checks: readonly { name: string; passed: boolean }[]; }
export interface SimulationReport extends StudioReport { fixtureId: string; timeline: readonly { stageId: string; agentId: string; outcome: 'completed' | 'budget-exhausted' }[]; }
export interface GateReport extends StudioReport { ledgerId: string; gates: readonly { name: string; passed: boolean; reason: string }[]; }
const now = (): string => new Date().toISOString();
const report = <Value extends StudioReport>(value: Value): Value => Object.freeze({ ...value, evidenceIds: Object.freeze([...value.evidenceIds]), reasonCodes: Object.freeze([...value.reasonCodes]) }) as Value;
const uuidFromDigest = (value: string): string => `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;

/** Static checks are tied to one saved revision; missing or failed checks never become a pass. */
export async function runChecks(revision: StudioStoredDraft): Promise<CheckReport> {
  const startedAt = now(); const issues = validateStudioDraft(revision.draft); let manifest = false;
  try { await assemblePackage(revision.draft); manifest = true; } catch { manifest = false; }
  const checks = [...issues.map((item) => ({ name: item.code, passed: false })), { name: 'manifest-digest', passed: manifest }, { name: 'revision-digest', passed: /^[a-f0-9]{64}$/u.test(revision.digest) }];
  const passed = checks.every((check) => check.passed); const evidenceId = await digest({ subjectDigest: revision.digest, checks });
  return report({ subjectDigest: revision.digest, engine: 'studio-checks', engineVersion: '1.0.0', environment: 'local', classification: 'unverified', startedAt, completedAt: now(), status: passed ? 'passed' : 'failed', evidenceIds: [evidenceId], reasonCodes: passed ? [] : checks.filter((check) => !check.passed).map((check) => check.name), checks: Object.freeze(checks) });
}

/** Fixture simulation never dispatches a live provider; it only exposes bounded workflow outcomes. */
export async function simulate(revision: StudioStoredDraft, fixtureId: string): Promise<SimulationReport> {
  const startedAt = now(); const checks = await runChecks(revision); const totalTokens = revision.draft.agents.reduce((total, agent) => total + agent.budgets.tokens, 0); const exhausted = totalTokens > revision.draft.team.budgets.tokens;
  const timeline = revision.draft.workflow.stages.map((stage) => ({ stageId: stage.id, agentId: stage.agentId, outcome: exhausted ? 'budget-exhausted' as const : 'completed' as const })); const status = checks.status === 'passed' && !exhausted ? 'passed' : 'failed'; const evidenceId = await digest({ subjectDigest: revision.digest, fixtureId, timeline });
  return report({ subjectDigest: revision.digest, engine: 'studio-simulator', engineVersion: '1.0.0', environment: 'local', classification: 'fixture', startedAt, completedAt: now(), status, evidenceIds: [evidenceId], reasonCodes: status === 'passed' ? [] : exhausted ? ['BUDGET_EXHAUSTED'] : checks.reasonCodes, fixtureId, timeline: Object.freeze(timeline) });
}

/** Fixture evaluation writes immutable ledger evidence but remains blocked for release without live certification. */
export async function evaluate(revision: StudioStoredDraft, suiteId: string, ledger = new EvaluationLedger()): Promise<GateReport> {
  const startedAt = now(); const checks = await runChecks(revision); const simulation = await simulate(revision, suiteId); const evidenceId = await digest({ subjectDigest: revision.digest, suiteId, checks: checks.evidenceIds, simulation: simulation.evidenceIds });
  const record = await ledger.append({ id: uuidFromDigest(evidenceId), tenantId: revision.tenantId, kind: 'deterministic-check', subject: { id: revision.id, version: String(revision.revision), digest: revision.digest }, dataset: { digest: evidenceId, rule: suiteId }, rubric: 'studio-release', evaluator: 'studio-evaluator@1.0.0', environment: 'local', aggregation: 'all', evidence: [{ id: evidenceId, digest: evidenceId, classification: 'restricted-operational' }], score: checks.status === 'passed' && simulation.status === 'passed' ? 1 : 0, confidence: 1, evidenceCurrent: true, conflicting: false });
  const decision = new GateCalculator().calculate({ subjectDigest: revision.digest, dependencies: [revision.digest], hard: [{ name: 'checks', passed: checks.status === 'passed' }, { name: 'simulation', passed: simulation.status === 'passed' }, { name: 'live-certification', passed: false }], objectives: [], exceptions: [] });
  return report({ subjectDigest: revision.digest, engine: 'studio-evaluator', engineVersion: '1.0.0', environment: 'local', classification: 'fixture', startedAt, completedAt: now(), status: decision.releasable ? 'passed' : 'blocked', evidenceIds: [record.id], reasonCodes: decision.results.filter((gate) => !gate.passed).map((gate) => gate.name), ledgerId: record.id, gates: Object.freeze(decision.results) });
}
