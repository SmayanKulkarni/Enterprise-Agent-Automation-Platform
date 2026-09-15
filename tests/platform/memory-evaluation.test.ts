import { describe, expect, test } from 'vitest';

import {
  EvaluationLedger,
  GateCalculator,
  GovernedMemoryLifecycle,
  ImprovementOrchestrator,
  ProvenanceGraph,
  StrategySelector,
  ValidatedExperienceRegistry,
} from '../../packages/memory/src/index.js';
import { CapabilityMemoryWorkbench, ImprovementWorkbench } from '../../packages/browser/src/index.js';
import { tenantId } from '../../packages/contracts/src/index.js';
import { SolutionLifecycle } from '../../packages/lifecycle/src/index.js';

const tenant = '22222222-2222-4222-8222-222222222222';
const later = '2099-01-02T00:00:00.000Z';
const now = '2099-01-01T00:00:00.000Z';
const provenance = (id: string, parents: readonly string[] = []) => ({ id, tenantId: tenant, scope: { kind: 'tenant' as const, tenantId: tenant }, purpose: 'knowledge', classification: 'ordinary' as const, legalBasis: 'contract', retention: 'standard', locations: ['memory://primary'], transformation: 'ingest', parents, digest: (id[0] ?? 'a').repeat(64) });

describe('memory lifecycle and governed improvement', () => {
  test('keeps lifecycle and experience changes append-only and query-safe', async () => {
    const graph = new ProvenanceGraph();
    graph.add(provenance('a-source')); graph.add(provenance('b-derived', ['a-source']));
    const lifecycle = new GovernedMemoryLifecycle(graph);
    const correction = lifecycle.correct({ replacedId: 'a-source', replacement: provenance('c-source'), authorized: true });
    expect(correction.descendants).toEqual(['b-derived']);
    expect(graph.eligible('b-derived')).toBe(false);
    const deletion = lifecycle.delete({ tenantId: tenant, manifest: [{ id: 'c-source', kind: 'record' }, { id: 'b-derived', kind: 'index' }], authorized: true });
    expect(deletion.complete).toBe(true);
    lifecycle.hold({ id: 'hold-1', tenantId: tenant, provenanceIds: ['c-source'], authorized: true, expiresAt: later });
    expect(() => lifecycle.delete({ tenantId: tenant, manifest: [{ id: 'c-source', kind: 'record' }], authorized: true })).toThrow('Memory request was not accepted.');
    lifecycle.releaseHold('hold-1', true);
    expect(lifecycle.restore({ tenantId: tenant, provenanceIds: ['c-source'], policyCurrent: true, residueAbsent: true, authorized: true }).state).toBe('restored');

    const experiences = new ValidatedExperienceRegistry(graph, () => now);
    const candidate = await experiences.create({ id: 'experience-1', tenantId: tenant, authorId: 'author', scope: { kind: 'tenant', tenantId: tenantId(tenant) }, provenanceIds: ['c-source'], evidenceIds: ['ledger-1'], classification: 'ordinary', fingerprint: 'fact-v1', expiresAt: later });
    const approved = experiences.review({ candidateId: candidate.id, reviewerId: 'reviewer', authorityCurrent: true, evidenceCurrent: true, redactionPassed: true, scopeReviewed: true, approve: true });
    expect(approved.status).toBe('approved');
    expect(() => experiences.review({ candidateId: candidate.id, reviewerId: 'author', authorityCurrent: true, evidenceCurrent: true, redactionPassed: true, scopeReviewed: true, approve: true })).toThrow();
  });

  test('preserves ledger comparability and fences gates, candidates and rollout', async () => {
    const ledger = new EvaluationLedger(() => now);
    const fixture = { tenantId: tenant, subject: { id: 'candidate-1', version: '1', digest: 'a'.repeat(64) }, dataset: { digest: 'b'.repeat(64), rule: 'holdout-v1' }, rubric: 'quality-v1', evaluator: 'human-v1', environment: 'fixture', aggregation: 'mean-v1', evidence: [{ id: 'evidence-1', digest: 'c'.repeat(64), classification: 'immutable-audit' as const }], score: 0.9, confidence: 0.95, evidenceCurrent: true, conflicting: false };
    const first = await ledger.append({ ...fixture, id: 'ledger-1', kind: 'human-review' });
    const second = await ledger.append({ ...fixture, id: 'ledger-2', kind: 'model-judgment', weakLabelWeight: 0.1, calibrated: true });
    expect(ledger.aggregate([first.id, second.id]).score).toBe(0.9);
    expect(ledger.compare(first.id, second.id).status).toBe('comparable');
    const incompatible = await ledger.append({ ...fixture, id: 'ledger-3', kind: 'deterministic-check', rubric: 'safety-v1' });
    expect(ledger.compare(first.id, incompatible.id).status).toBe('not-comparable');

    const gates = new GateCalculator(() => now).calculate({ subjectDigest: fixture.subject.digest, dependencies: ['dataset-v1'], hard: [{ name: 'isolation', passed: true }], objectives: [{ name: 'quality', score: 0.9, lowerBound: 0.85, threshold: 0.8, samples: 50, minimumSamples: 50 }], exceptions: [] });
    expect(gates.releasable).toBe(true);
    const orchestrator = new ImprovementOrchestrator(() => now);
    const candidate = await orchestrator.create({ id: 'candidate-1', tenantId: tenant, championDigest: 'd'.repeat(64), candidateDigest: fixture.subject.digest, allowedChanges: ['planning'], changes: ['planning'], guardrailsPreserved: true });
    expect(orchestrator.evaluate(candidate.id, candidate.version, { gate: gates, authorityCurrent: true, dataset: { completedCases: 50, strata: [10, 40], weakLabelWeight: 0.2, safetyWeakLabels: false, contaminated: false, current: true } }).state).toBe('evaluated');
    const shadow = orchestrator.startShadow(candidate.id, 2, { matchedCases: 30, days: 7, nonInferior: true, hardRegression: false });
    const canary = orchestrator.startCanary(candidate.id, shadow.version, { percentage: 10, cases: 10, days: 7, lowRiskOnly: true, clean: true });
    const promoted = orchestrator.promote(candidate.id, canary.version, { authorityCurrent: true, incidentsOpen: false, gate: gates, runningCaseDisposition: 'pin-current' });
    expect(promoted.state).toBe('promoted');
    expect(orchestrator.rollback(candidate.id, promoted.version, { hardFailure: false, authorityAnomaly: false, criticalIncident: true, qualityRegression: 0, latencyRegression: 0, costRegression: 0, interventionRegression: false }).state).toBe('rolled-back');
  });

  test('keeps provider and memory browser state partial and command-only', () => {
    const view = new CapabilityMemoryWorkbench();
    expect(view.ingest({ tenantId: tenant, collection: 'memory', completeness: 'partial', records: [{ id: 'record-1', state: 'held', provenance: 'source-1' }] }).completeness).toBe('partial');
    expect(() => view.ingest({ tenantId: tenant, collection: 'capabilities', completeness: 'full', records: [{ token: 'never-client-side' }] })).toThrow();
    expect(view.command({ owner: 'memory', name: 'delete', expectedVersion: 2, idempotencyKey: 'key', arguments: { manifest: ['record-1'] } }).name).toBe('delete');
    expect(() => view.command({ owner: 'memory', name: 'delete', expectedVersion: 2, idempotencyKey: 'key', arguments: {} })).toThrow();
  });

  test('falls back outside selector evidence and fences package publication through activation', async () => {
    const selector = new StrategySelector();
    expect(selector.select({ approved: [{ name: 'rules', version: '1' }, { name: 'learned', version: '1' }], fallback: { name: 'rules', version: '1' }, requested: 'learned', evidence: { eligibleCases: 200, perStrategyStratum: [30], holdoutClean: true, calibratedBenefit: true, shadowAndCanaryPassed: true, current: true, drifted: false, available: true, authorityCurrent: true } }).strategy).toBe('learned');
    expect(selector.select({ approved: [{ name: 'rules', version: '1' }], fallback: { name: 'rules', version: '1' }, evidence: { eligibleCases: 0, perStrategyStratum: [], holdoutClean: false, calibratedBenefit: false, shadowAndCanaryPassed: false, current: false, drifted: true, available: false, authorityCurrent: false } }).fallback).toBe(true);
    const improvements = new ImprovementWorkbench();
    expect(improvements.ingest({ tenantId: tenant, collection: 'improvements', completeness: 'full', version: '1.0.0', records: [{ id: 'candidate-1', stale: true }] }).completeness).toBe('partial');
    expect(() => improvements.command({ name: 'promote', expectedVersion: 1, idempotencyKey: 'promote-1', gateCurrent: false, r3Approved: true, arguments: {} })).toThrow();

    const lifecycle = new SolutionLifecycle();
    const draft = lifecycle.author({ id: 'technical', version: '1.0.0', author: 'author', artifacts: [{ id: 'workflow', version: '1', digest: 'a'.repeat(64), kind: 'workflow', content: { stages: ['start'] } }], dependencies: [], bindings: ['provider-ref'], overlayPaths: ['/budget'] });
    const resolved = await lifecycle.resolve(draft.id, draft.version, { '/budget': 1 });
    expect((await lifecycle.validate(resolved.digest, { hardPassed: true, evidenceCurrent: true, comparable: true, liveCertified: true, subjectDigest: resolved.digest })).valid).toBe(true);
    const published = await lifecycle.publish({ packageDigest: resolved.digest, approver: 'approver', signer: 'signer', publisher: 'publisher', keyId: 'key-1', tenantIds: [tenant] });
    const readiness = await lifecycle.install({ id: 'install-1', tenantId: tenant, packageDigest: published.digest, epochs: { policy: 1, provider: 1 }, checksCurrent: true });
    const activation = lifecycle.activate({ idempotencyKey: 'activate-1', id: 'activation-1', tenantId: tenant, installationId: 'install-1', readinessDigest: readiness.digest, expectedVersion: 1 });
    expect(lifecycle.pin(activation.id, tenant).packageDigest).toBe(resolved.digest);
    lifecycle.revoke(resolved.digest);
    expect(() => lifecycle.pin(activation.id, tenant)).toThrow();
  });
});
