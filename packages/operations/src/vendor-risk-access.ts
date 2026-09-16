import { canonicalJson, digest, tenantId, type TenantId } from '../../contracts/src/index.js';
import type { BrowserCommandHandler } from '../../browser/src/index.js';
import { SolutionLifecycle, type Activation } from '../../lifecycle/src/index.js';
import { SHARED_PLATFORM_MODULE_DIGESTS } from './technical-implementation.js';

export const VENDOR_RISK_ACCESS_VERSION = '1.0.0';
export const VENDOR_SHARED_MODULE_DIGESTS = SHARED_PLATFORM_MODULE_DIGESTS;
export type AssessmentOutcome = 'approved-with-conditions' | 'denied' | 'insufficient-evidence';
export type GrantState = 'proposed' | 'approved' | 'provisioned' | 'reconciliation-required' | 'revocation-pending' | 'revoked';
export interface VendorEvidence { id: string; sourceVersion: string; digest: string; expiresAt: string; }
export interface VendorAssessment { id: string; tenantId: TenantId; vendor: string; version: number; evidence: readonly VendorEvidence[]; expiresAt: string; current: boolean; outcome?: AssessmentOutcome; }
export interface AccessGrant { id: string; tenantId: TenantId; assessmentId: string; assessmentVersion: number; subject: string; resource: string; privilege: string; purpose: string; expiresAt: string; initiator: string; canonicalDigest: string; state: GrantState; approvalId?: string; }
export class VendorRiskAccessError extends Error { constructor(public readonly code: 'CONFLICT' | 'DENIED' | 'NOT_FOUND' | 'STALE') { super('Vendor Risk and Access request was not accepted.'); this.name = 'VendorRiskAccessError'; } }
const fail = (code: VendorRiskAccessError['code']): never => { throw new VendorRiskAccessError(code); };
const copy = <Value>(value: Value): Value => Object.freeze(JSON.parse(canonicalJson(value)) as Value);
const sha256 = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const future = (value: string, now: string): boolean => Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.parse(now);

/** Fixture-safe linked Case seam. Provider calls remain behind the existing Gateway adapters. */
export class VendorRiskAccessRuntime {
  readonly #assessments = new Map<string, VendorAssessment>(); readonly #grants = new Map<string, AccessGrant>(); readonly #generated = new Set<string>();
  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  createAssessment(input: { id: string; tenantId: string; vendor: string; evidence: readonly VendorEvidence[]; expiresAt: string }): VendorAssessment {
    const tenant = tenantId(input.tenantId);
    if (!input.id || !input.vendor || this.#assessments.has(input.id) || !future(input.expiresAt, this.now()) || !input.evidence.length || new Set(input.evidence.map((item) => item.id)).size !== input.evidence.length || input.evidence.some((item) => !item.id || !item.sourceVersion || !sha256(item.digest) || !future(item.expiresAt, this.now()))) fail('DENIED');
    const assessment = copy({ ...input, tenantId: tenant, version: 1, evidence: [...input.evidence].sort((left, right) => left.id.localeCompare(right.id)), current: true }); this.#assessments.set(assessment.id, assessment); this.#generated.add(`assessment:${assessment.id}`); return assessment;
  }

  decideAssessment(input: { id: string; tenantId: string; expectedVersion: number; outcome: AssessmentOutcome; policyAnalyst: string; evidenceVerifier: string; riskOwner: string; conflicting: boolean }): VendorAssessment {
    const assessment = this.assessment(input.id, input.tenantId);
    if (assessment.version !== input.expectedVersion || !assessment.current || !future(assessment.expiresAt, this.now()) || assessment.evidence.some((item) => !future(item.expiresAt, this.now())) || input.conflicting || !input.policyAnalyst || !input.evidenceVerifier || !input.riskOwner || new Set([input.policyAnalyst, input.evidenceVerifier, input.riskOwner]).size !== 3) fail('STALE');
    const next = copy({ ...assessment, version: assessment.version + 1, outcome: input.outcome }); this.#assessments.set(next.id, next); return next;
  }

  supersede(input: { id: string; tenantId: string; expectedVersion: number; evidence: readonly VendorEvidence[]; expiresAt: string }): VendorAssessment {
    const previous = this.assessment(input.id, input.tenantId);
    if (previous.version !== input.expectedVersion || !previous.current || !future(input.expiresAt, this.now()) || !input.evidence.length || new Set(input.evidence.map((item) => item.id)).size !== input.evidence.length || input.evidence.some((item) => !item.id || !item.sourceVersion || !sha256(item.digest) || !future(item.expiresAt, this.now()))) fail('STALE');
    this.#assessments.set(previous.id, copy({ ...previous, current: false }));
    const next = copy({ id: `${previous.id}:v${String(previous.version + 1)}`, tenantId: tenantId(input.tenantId), vendor: previous.vendor, version: previous.version + 1, evidence: [...input.evidence].sort((left, right) => left.id.localeCompare(right.id)), expiresAt: input.expiresAt, current: true }); this.#assessments.set(next.id, next); this.#generated.add(`assessment:${next.id}`); return next;
  }

  async requestGrant(input: { id: string; tenantId: string; assessmentId: string; assessmentVersion: number; subject: string; resource: string; privilege: string; purpose: string; expiresAt: string; initiator: string }): Promise<AccessGrant> {
    const tenant = tenantId(input.tenantId); const assessment = this.assessment(input.assessmentId, String(tenant));
    if (this.#grants.has(input.id) || !assessment.current || assessment.version !== input.assessmentVersion || assessment.outcome !== 'approved-with-conditions' || !future(assessment.expiresAt, this.now()) || !future(input.expiresAt, this.now()) || Date.parse(input.expiresAt) > Date.parse(assessment.expiresAt) || ![input.id, input.subject, input.resource, input.privilege, input.purpose, input.initiator].every(Boolean)) fail('DENIED');
    const canonicalDigest = await digest({ tenantId: String(tenant), assessmentId: assessment.id, assessmentVersion: assessment.version, subject: input.subject, resource: input.resource, privilege: input.privilege, purpose: input.purpose, expiresAt: input.expiresAt });
    const grant = copy({ ...input, tenantId: tenant, canonicalDigest, state: 'proposed' as const }); this.#grants.set(grant.id, grant); this.#generated.add(`grant:${grant.id}`); return grant;
  }

  approveGrant(input: { id: string; tenantId: string; canonicalDigest: string; approver: string; approvalId: string }): AccessGrant {
    const grant = this.grant(input.id, input.tenantId); const assessment = this.assessment(grant.assessmentId, input.tenantId);
    if (grant.state !== 'proposed' || grant.canonicalDigest !== input.canonicalDigest || !input.approver || !input.approvalId || input.approver === grant.initiator || !assessment.current || assessment.version !== grant.assessmentVersion || assessment.outcome !== 'approved-with-conditions' || !future(assessment.expiresAt, this.now()) || !future(grant.expiresAt, this.now())) fail('STALE');
    const next = copy({ ...grant, state: 'approved' as const, approvalId: input.approvalId }); this.#grants.set(next.id, next); return next;
  }

  provision(input: { id: string; tenantId: string; graph: 'succeeded' | 'unknown-outcome' | 'failed'; jira: 'succeeded' | 'unknown-outcome' | 'failed' }): AccessGrant {
    const grant = this.grant(input.id, input.tenantId); if (grant.state !== 'approved') fail('STALE');
    const state: GrantState = input.graph === 'succeeded' && input.jira === 'succeeded' ? 'provisioned' : 'reconciliation-required'; const next = copy({ ...grant, state }); this.#grants.set(next.id, next); if (state === 'provisioned') { this.#generated.add(`graph:${grant.id}`); this.#generated.add(`jira:${grant.id}`); } return next;
  }

  revoke(input: { id: string; tenantId: string; reason: 'manual' | 'policy' | 'expiry'; graph: 'succeeded' | 'unknown-outcome' | 'failed'; jira: 'succeeded' | 'unknown-outcome' | 'failed' }): AccessGrant {
    const grant = this.grant(input.id, input.tenantId); if (!['provisioned', 'reconciliation-required', 'revocation-pending'].includes(grant.state)) fail('STALE');
    const state: GrantState = input.graph === 'succeeded' && input.jira === 'succeeded' ? 'revoked' : 'revocation-pending'; const next = copy({ ...grant, state }); this.#grants.set(next.id, next); return next;
  }
  expire(input: Omit<Parameters<VendorRiskAccessRuntime['revoke']>[0], 'reason'>): AccessGrant { return this.revoke({ ...input, reason: 'expiry' }); }
  reconcileRevoke(input: { id: string; tenantId: string; graphConfirmed: boolean; jiraConfirmed: boolean }): AccessGrant {
    const grant = this.grant(input.id, input.tenantId); if (grant.state !== 'revocation-pending') fail('STALE'); const next = copy({ ...grant, state: input.graphConfirmed && input.jiraConfirmed ? 'revoked' as const : 'revocation-pending' as const }); this.#grants.set(next.id, next); return next;
  }

  reset(input: { held?: boolean; foreign?: boolean } = {}): { state: 'complete' | 'blocked'; residual: readonly string[] } { if (input.held || input.foreign) return { state: 'blocked', residual: Object.freeze([...(input.held ? ['held-evidence'] : []), ...(input.foreign ? ['foreign-object'] : [])]) }; const residual = [...this.#grants.values()].filter((grant) => grant.state !== 'revoked').map((grant) => `grant:${grant.id}`); if (residual.length) return { state: 'blocked', residual: Object.freeze(residual.sort()) }; this.#generated.clear(); return { state: 'complete', residual: Object.freeze([]) }; }
  assessment(id: string, tenant: string): VendorAssessment { const assessment = this.#assessments.get(id) ?? fail('NOT_FOUND'); if (assessment.tenantId !== tenantId(tenant)) fail('DENIED'); return assessment; }
  grant(id: string, tenant: string): AccessGrant { const grant = this.#grants.get(id) ?? fail('NOT_FOUND'); if (grant.tenantId !== tenantId(tenant)) fail('DENIED'); return grant; }
  browserCommands(): Readonly<Record<string, BrowserCommandHandler>> { return Object.freeze({
    'vendor.start': (command) => ({ caseType: 'vendor-assessment', fixtureLabel: 'fixture', correlationId: command.correlationId }),
    'vendor.approve': (command) => ({ state: 'approval-pending', fixtureLabel: 'fixture', correlationId: command.correlationId }),
    'vendor.provision': (command) => ({ state: 'reconciliation-required', fixtureLabel: 'fixture', correlationId: command.correlationId }),
    'vendor.revoke': (command) => ({ state: 'revocation-pending', fixtureLabel: 'fixture', correlationId: command.correlationId }),
  }); }
}

/** Signed second-package fixture. The shared module pins are data, never a platform fork. */
export async function vendorRiskAccessPackageFixture(tenant: string): Promise<{ activation: Activation; moduleDigests: typeof VENDOR_SHARED_MODULE_DIGESTS }> {
  const lifecycle = new SolutionLifecycle(); const draft = lifecycle.author({ id: 'vendor-risk-access', version: VENDOR_RISK_ACCESS_VERSION, author: 'vendor-author', artifacts: [{ id: 'vendor-assessment-and-grant', version: VENDOR_RISK_ACCESS_VERSION, digest: 'e'.repeat(64), kind: 'workflow', content: { caseTypes: ['vendor-assessment', 'access-grant'], roles: ['policy-analyst', 'evidence-verifier', 'risk-owner', 'case-approver'], capabilities: ['graph.membership.add', 'graph.membership.remove', 'jira.review.create', 'jira.review.revoke'], moduleDigests: VENDOR_SHARED_MODULE_DIGESTS } }], dependencies: Object.entries(VENDOR_SHARED_MODULE_DIGESTS).map(([id, digest]) => ({ id, version: '1.0.0', digest })), bindings: ['graph-vendor', 'jira-vendor'], overlayPaths: ['/duration'] });
  const resolved = await lifecycle.resolve(draft.id, draft.version, { '/duration': 'P30D' }); await lifecycle.validate(resolved.digest, { hardPassed: true, evidenceCurrent: true, comparable: true, liveCertified: true, subjectDigest: resolved.digest }); const publication = await lifecycle.publish({ packageDigest: resolved.digest, approver: 'vendor-approver', signer: 'vendor-signer', publisher: 'vendor-publisher', keyId: 'vendor-key', tenantIds: [tenant] }); const readiness = await lifecycle.install({ id: `vendor-installation-${tenant}`, tenantId: tenant, packageDigest: publication.digest, epochs: { graph: 1, jira: 1, credential: 1, policy: 1 }, checksCurrent: true });
  return { activation: lifecycle.activate({ idempotencyKey: `vendor-activate-${tenant}`, id: `vendor-activation-${tenant}`, tenantId: tenant, installationId: `vendor-installation-${tenant}`, readinessDigest: readiness.digest, expectedVersion: 1 }), moduleDigests: VENDOR_SHARED_MODULE_DIGESTS };
}
