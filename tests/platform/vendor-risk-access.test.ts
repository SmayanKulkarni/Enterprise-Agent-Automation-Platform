import { describe, expect, test } from 'vitest';

import { ReadinessWorkbench, VendorCaseWorkbench } from '../../packages/browser/src/index.js';
import { SHARED_PLATFORM_MODULE_DIGESTS, VendorRiskAccessError, VendorRiskAccessRuntime, VENDOR_SHARED_MODULE_DIGESTS, vendorRiskAccessPackageFixture } from '../../packages/operations/src/index.js';
import { combinedProviderReadiness, type ProviderReadinessRecord } from '../../packages/providers/src/index.js';

const tenant = '22222222-2222-4222-8222-222222222222';
const foreignTenant = '33333333-3333-4333-8333-333333333333';
const now = '2098-01-01T00:00:00.000Z';
const future = '2099-01-01T00:00:00.000Z';
const readiness = (classification: 'fixture' | 'live' = 'fixture'): ProviderReadinessRecord[] => [
  ['technical-implementation', 'graph'], ['technical-implementation', 'sql'], ['technical-implementation', 'blob'], ['technical-implementation', 'boards'], ['vendor-risk-access', 'graph'], ['vendor-risk-access', 'jira'],
].map(([solution, provider], index) => ({ tenantId: tenant, solution: solution as ProviderReadinessRecord['solution'], provider: provider as ProviderReadinessRecord['provider'], installationId: `installation-${String(index)}`, credentialEpoch: 1, schemaVersion: 'v1', checkpoint: `checkpoint-${String(index)}`, state: 'ready', classification }));

describe('M10/M11 fixture-safe provider readiness and Vendor Risk and Access', () => {
  test('requires exact two-solution allocations and preserves readiness labels', async () => {
    await expect(combinedProviderReadiness({ tenantId: tenant, records: readiness() })).resolves.toMatchObject({ classification: 'fixture' });
    const duplicate = readiness(); const first = duplicate.at(0); if (first === undefined) throw new Error('fixture is incomplete'); duplicate.push({ ...first, installationId: 'duplicate' });
    await expect(combinedProviderReadiness({ tenantId: tenant, records: duplicate })).rejects.toThrow();
    await expect(combinedProviderReadiness({ tenantId: tenant, records: readiness('live') })).rejects.toThrow();

    const view = new ReadinessWorkbench();
    expect(view.ingest({ tenantId: tenant, collection: 'readiness', completeness: 'full', version: '1.0.0', records: [{ provider: 'graph', classification: 'fixture' }] }).completeness).toBe('partial');
    expect(() => view.ingest({ tenantId: tenant, collection: 'readiness', completeness: 'full', version: '1.0.0', records: [{ provider: 'graph', classification: 'live' }] })).toThrow('INVALID_BROWSER_DTO');
  });

  test('pins a current assessment, denies stale/foreign grant paths, and keeps revoke pending until reconciliation', async () => {
    const runtime = new VendorRiskAccessRuntime(() => now);
    const assessment = runtime.createAssessment({ id: 'assessment-1', tenantId: tenant, vendor: 'vendor-1', evidence: [{ id: 'evidence-1', sourceVersion: '2026-09', digest: 'a'.repeat(64), expiresAt: future }], expiresAt: future });
    const decided = runtime.decideAssessment({ id: assessment.id, tenantId: tenant, expectedVersion: assessment.version, outcome: 'approved-with-conditions', policyAnalyst: 'analyst', evidenceVerifier: 'verifier', riskOwner: 'risk-owner', conflicting: false });
    const grant = await runtime.requestGrant({ id: 'grant-1', tenantId: tenant, assessmentId: decided.id, assessmentVersion: decided.version, subject: 'demo-user', resource: 'demo-group', privilege: 'member', purpose: 'vendor-review', expiresAt: future, initiator: 'requester' });
    await expect(runtime.requestGrant({ id: 'foreign-grant', tenantId: foreignTenant, assessmentId: decided.id, assessmentVersion: decided.version, subject: 'demo-user', resource: 'demo-group', privilege: 'member', purpose: 'vendor-review', expiresAt: future, initiator: 'requester' })).rejects.toMatchObject({ code: 'DENIED' });
    const approved = runtime.approveGrant({ id: grant.id, tenantId: tenant, canonicalDigest: grant.canonicalDigest, approver: 'case-approver', approvalId: 'approval-1' });
    expect(runtime.provision({ id: approved.id, tenantId: tenant, graph: 'succeeded', jira: 'succeeded' }).state).toBe('provisioned');
    expect(runtime.revoke({ id: approved.id, tenantId: tenant, reason: 'expiry', graph: 'unknown-outcome', jira: 'succeeded' }).state).toBe('revocation-pending');
    expect(runtime.reconcileRevoke({ id: approved.id, tenantId: tenant, graphConfirmed: true, jiraConfirmed: true }).state).toBe('revoked');
    expect(runtime.reset()).toEqual({ state: 'complete', residual: [] });
    expect(() => runtime.grant(approved.id, foreignTenant)).toThrow(VendorRiskAccessError);
  });

  test('uses the shared lifecycle and browser codecs without treating a stale linked Case as displayable', async () => {
    const fixture = await vendorRiskAccessPackageFixture(tenant);
    expect(fixture.activation.packageDigest).toHaveLength(64); expect(fixture.moduleDigests).toBe(SHARED_PLATFORM_MODULE_DIGESTS); expect(VENDOR_SHARED_MODULE_DIGESTS).toBe(SHARED_PLATFORM_MODULE_DIGESTS);
    const view = new VendorCaseWorkbench();
    expect(view.ingest({ tenantId: tenant, collection: 'access-grants', completeness: 'full', version: '1.0.0', records: [{ tenantId: tenant, assessmentId: 'assessment-1', assessmentVersion: 2, state: 'revocation-pending' }] }).completeness).toBe('partial');
    expect(() => view.ingest({ tenantId: tenant, collection: 'access-grants', completeness: 'full', version: '1.0.0', records: [{ tenantId: foreignTenant, assessmentId: 'assessment-1', assessmentVersion: 2 }] })).toThrow('INVALID_BROWSER_DTO');
  });
});
