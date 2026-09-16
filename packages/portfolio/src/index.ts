import { canonicalJson, digest } from '../../contracts/src/index.js';

export type DemoEvidenceClassification = 'fixture' | 'simulated-failure' | 'live' | 'documented-only';
export const PORTFOLIO_JOURNEYS = Object.freeze(['bootstrap', 'technical-success', 'vendor-success', 'denial-staleness', 'provider-degradation', 'duplicate-reconcile', 'owner-recovery', 'package-lifecycle', 'improvement-rollout', 'backup-restore', 'teardown'] as const);
export const DRILL_INJECTIONS = Object.freeze(['migration-crash', 'tampered-package', 'rollback-request', 'gate-failure', 'selector-outage', 'notification-failure', 'restore-crash', 'provider-removal-failure', 'lease-expiry'] as const);
type Journey = typeof PORTFOLIO_JOURNEYS[number];
type Injection = typeof DRILL_INJECTIONS[number];

export interface DemoEvidence { id: string; path: string; classification: DemoEvidenceClassification; producer: string; recordedAt: string; correlationId: string; payload: Record<string, unknown>; digest: string; }
export interface DemoStep { journey: Journey; command: string; prerequisites: readonly string[]; injection?: Injection; expected: string; ownerAction: string; timeoutSeconds: number; evidenceIds: readonly string[]; outcome: 'passed' | 'blocked'; }
export interface DemoRunManifest { schemaVersion: '1.0.0'; id: string; operator: string; startedAt: string; endedAt: string; packageDigests: readonly string[]; environment: Record<string, string>; steps: readonly DemoStep[]; evidence: readonly DemoEvidence[]; digest: string; }
export interface RubricClaim { pillar: 'product' | 'engineering' | 'operational'; id: string; evidenceIds: readonly string[]; passed: boolean; critical?: boolean; }
export interface RubricScore { pillars: Readonly<Record<RubricClaim['pillar'], number>>; total: number; complete: boolean; digest: string; }
export class PortfolioDrillError extends Error { constructor(public readonly code: 'CONFLICT' | 'DENIED' | 'INVALID' | 'STALE') { super('Portfolio drill was not accepted.'); this.name = 'PortfolioDrillError'; } }
const fail = (code: PortfolioDrillError['code']): never => { throw new PortfolioDrillError(code); };
const frozen = <Value>(value: Value): Value => Object.freeze(JSON.parse(canonicalJson(value)) as Value);
const safe = (value: unknown): boolean => value === null || typeof value !== 'object'
  ? typeof value !== 'string' || !/(?:bearer\s+|-----begin|api[_-]?key|secret|token|password)/iu.test(value)
  : Array.isArray(value) ? value.every(safe)
    : Object.entries(value as Record<string, unknown>).every(([key, child]) => !/(?:secret|token|password|authorization|credential)/iu.test(key) && safe(child));
const validTime = (value: string): boolean => Number.isFinite(Date.parse(value));

/** Immutable local evidence gate. It deliberately cannot turn fixture output into live evidence. */
export class PortfolioDrillHarness {
  readonly #published = new Map<string, DemoRunManifest>();
  constructor(private readonly verifyLive: (evidence: DemoEvidence) => Promise<boolean> | boolean = () => false, private readonly now: () => string = () => new Date().toISOString()) {}

  async evidence(input: Omit<DemoEvidence, 'digest'>): Promise<DemoEvidence> {
    if (!input.id || !input.path || !input.producer || !input.correlationId || !validTime(input.recordedAt) || !safe(input.payload)) fail('INVALID');
    const base = { id: input.id, path: input.path, classification: input.classification, producer: input.producer, recordedAt: input.recordedAt, correlationId: input.correlationId, payload: input.payload };
    return frozen({ ...base, digest: await digest(base) });
  }

  async publish(input: Omit<DemoRunManifest, 'digest'>): Promise<DemoRunManifest> {
    if (this.#published.has(input.id)) fail('CONFLICT');
    const invalidStep = input.steps.some((step) => !step.command || !step.expected || !step.ownerAction || !Number.isInteger(step.timeoutSeconds) || step.timeoutSeconds < 1 || !step.evidenceIds.length || step.evidenceIds.some((id) => !input.evidence.some((evidence) => evidence.id === id)));
    if (!input.id || !input.operator || !validTime(input.startedAt) || !validTime(input.endedAt) || Date.parse(input.startedAt) > Date.parse(input.endedAt) || Date.parse(input.endedAt) > Date.parse(this.now()) || input.packageDigests.length !== 2 || new Set(input.packageDigests).size !== 2 || input.packageDigests.some((value) => !/^[a-f0-9]{64}$/u.test(value)) || input.steps.length !== PORTFOLIO_JOURNEYS.length || new Set(input.steps.map((step) => step.journey)).size !== PORTFOLIO_JOURNEYS.length || PORTFOLIO_JOURNEYS.some((journey) => !input.steps.some((step) => step.journey === journey)) || invalidStep) fail('INVALID');
    if (input.evidence.length === 0 || new Set(input.evidence.map((evidence) => evidence.id)).size !== input.evidence.length) fail('INVALID');
    for (const item of input.evidence) {
      const { digest: itemDigest, ...evidence } = item;
      if (!item.id || !item.path || !item.producer || !item.correlationId || !validTime(item.recordedAt) || !safe(item.payload) || item.classification === 'documented-only' || itemDigest !== (await digest(evidence))) fail('DENIED');
      if (item.classification === 'live' && !(await this.verifyLive(item))) fail('DENIED');
    }
    const manifest = frozen({ ...input, packageDigests: [...input.packageDigests].sort(), digest: await digest(input) }); this.#published.set(manifest.id, manifest); return manifest;
  }

  async score(manifest: DemoRunManifest, claims: readonly RubricClaim[]): Promise<RubricScore> {
    const published = this.#published.get(manifest.id);
    if (published === undefined || canonicalJson(published) !== canonicalJson(manifest) || claims.length !== 36 || new Set(claims.map((claim) => claim.id)).size !== claims.length || claims.some((claim) => !claim.id || !claim.evidenceIds.length || claim.evidenceIds.some((id) => !manifest.evidence.some((evidence) => evidence.id === id)))) fail('DENIED');
    const pillars = Object.fromEntries((['product', 'engineering', 'operational'] as const).map((pillar) => [pillar, claims.filter((claim) => claim.pillar === pillar && claim.passed).length])) as Record<RubricClaim['pillar'], number>;
    const total = Object.values(pillars).reduce((sum, value) => sum + value, 0); const complete = Object.values(pillars).every((value) => value >= 9) && total >= 30 && !claims.some((claim) => claim.critical && !claim.passed);
    const base = { pillars: frozen(pillars), total, complete }; return frozen({ ...base, digest: await digest({ ...base, manifest: manifest.digest, claims }) });
  }
}
