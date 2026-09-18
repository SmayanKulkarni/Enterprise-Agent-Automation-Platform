import { AzureSqlIdentityStore, IdentityStore } from '../../identity/src/index.js';
import { BrowserV1Transport, liveClerkSessionAdapter, type BrowserProjection, type ClerkBackend } from './index.js';
import { AzureSqlProjectionStore } from './sql-projections.js';

const required = (environment: Readonly<Record<string, string | undefined>>, name: string): string => {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};

/** Ephemeral local identity data for exercising a real Clerk session against browser.v1. */
export function localBrowserTransport(environment: Readonly<Record<string, string | undefined>>, backend?: ClerkBackend): BrowserV1Transport {
  const issuer = required(environment, 'CLERK_ISSUER');
  const authorizedParties = required(environment, 'CLERK_AUTHORIZED_PARTIES').split(',').map((origin) => origin.trim()).filter(Boolean);
  if (authorizedParties.length === 0) throw new Error('Missing CLERK_AUTHORIZED_PARTIES.');
  const connectionString = environment['AZURE_SQL_CONNECTION_STRING']?.trim();
  const identity = connectionString ? new AzureSqlIdentityStore(connectionString) : fixtureIdentity(
    issuer,
    required(environment, 'PLATFORM_LOCAL_CLERK_SUBJECT'),
    [...new Set(required(environment, 'PLATFORM_LOCAL_TENANTS').split(',').map((tenant) => tenant.trim()).filter(Boolean))],
  );
  const clerk = liveClerkSessionAdapter(environment, backend);
  const projectionStore = connectionString ? new AzureSqlProjectionStore(connectionString) : undefined;
  const projections = projectionStore === undefined ? fixtureProjection : (input: BrowserProjection) => projectionStore.read(input);
  return new BrowserV1Transport({ allowedOrigins: authorizedParties, clerk, identity, projections });
}

function fixtureIdentity(issuer: string, subject: string, tenantIds: readonly string[]): IdentityStore {
  if (tenantIds.length === 0) throw new Error('Missing PLATFORM_LOCAL_TENANTS.');
  const identity = new IdentityStore(); identity.mapUser(issuer, subject, subject);
  for (const tenantId of tenantIds) { identity.provision(tenantId); identity.transition(tenantId, 1, 'activate'); identity.membership(tenantId, subject, ['operator']); identity.setMembership(tenantId, subject, 1, 'current'); }
  return identity;
}

const fixtureMeta = { classification: 'fixture', freshness: 'current', completeness: 'full', redaction: 'none' } as const;

/** Synthetic browser-only projections. They are deliberately labelled fixture, never provider evidence. */
function fixtureProjection({ context, collection, id }: BrowserProjection): Record<string, unknown> {
  const tenantId = String(context.tenantId);
  const records: Record<string, readonly Record<string, unknown>[]> = {
    packages: [{ ...fixtureMeta, id: 'onboarding-assistant', name: 'Employee onboarding', version: '1.4.0', approval: 'approved', signature: 'verified', compatibility: 'compatible', validation: 'passed', simulation: 'passed', evaluation: 'current', evidence: 'immutable fixture evidence' }],
    installations: [{ ...fixtureMeta, id: 'onboarding-installation', package: 'Employee onboarding', version: '1.4.0', readiness: 'ready', configuration: 'fixture configuration verified', activation: 'active', provider: 'unavailable - no live provider adapter' }],
    cases: [{ ...fixtureMeta, id: 'technical-case', title: 'Technical implementation handoff', state: 'awaiting approval', correlation: 'fixture-correlation-01', environment: 'preview', outcome: 'pending', cost: 'unknown', evidence: 'partial fixture evidence' }],
    interventions: [{ ...fixtureMeta, id: 'approval-01', caseId: 'technical-case', type: 'approval', authority: 'release-approver', consequence: 'Allows fixture handoff only', compensation: 'reset fixture run', state: 'pending' }],
    operations: [{ ...fixtureMeta, id: 'effect-01', caseId: 'technical-case', effect: 'Provider provisioning', intent: 'simulated', receipt: 'unavailable', reconciliation: 'not started' }],
    readiness: [{ ...fixtureMeta, id: 'handoff-01', packagePin: 'onboarding-assistant@1.4.0', configurationEvidence: 'complete', completedChecks: 'validation, simulation, evaluation', openActions: 'approval required', rollback: 'fixture reset available' }],
    'vendor-assessments': [{ ...fixtureMeta, id: 'assessment-01', vendor: 'Northwind Systems', version: 2, state: 'current', policy: 'conditional approval', authority: 'risk owner', evidence: 'immutable fixture evidence', supersession: 'assessment-00 superseded' }],
    'access-grants': [{ ...fixtureMeta, id: 'grant-01', assessmentId: 'assessment-01', assessmentVersion: 2, subject: 'implementation-team', resource: 'project workspace', privilege: 'contributor', approval: 'approved', canonicalRequest: 'fixture canonical request', graph: 'simulated receipt', jira: 'simulated receipt', expiry: '2099-01-31T00:00:00.000Z', state: 'revocation-pending', reconciliation: 'receipt confirmation required' }],
    capabilities: [{ ...fixtureMeta, id: 'provider-adapter', name: 'Live provider operations', state: 'unavailable', reason: 'No independently verified live adapter is registered.' }],
    evaluations: [{ ...fixtureMeta, id: 'evaluation-01', package: 'Employee onboarding', state: 'current', evidence: 'fixture evaluation result' }],
    improvements: [{ ...fixtureMeta, id: 'improvement-01', state: 'not-ready', reason: 'Promotion requires current independently verified evidence.' }],
    deployments: [{ ...fixtureMeta, id: 'preview-01', environment: 'preview', state: 'fixture only', evidence: 'No Azure or provider operation was performed.' }],
    memory: [{ ...fixtureMeta, id: 'memory-01', state: 'redacted', completeness: 'partial', redaction: 'applied', reason: 'No memory contents are projected to this browser fixture.' }],
  };
  const selected = records[collection] ?? [];
  const scoped = id === undefined ? selected : selected.filter((record) => record['id'] === id);
  return { tenantId, collection, records: scoped, completeness: scoped.some((record) => record['redaction'] !== 'none' || record['state'] === 'unavailable' || record['state'] === 'not-ready') ? 'partial' : 'full', classification: 'fixture', freshness: 'current', redaction: scoped.some((record) => record['redaction'] !== 'none') ? 'applied' : 'none' };
}
