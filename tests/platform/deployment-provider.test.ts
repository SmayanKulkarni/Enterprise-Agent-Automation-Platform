import { describe, expect, test } from 'vitest';

import { closeEnvironment, DeploymentDirector, DeploymentError, exerciseRecovery, ProviderCertificationHarness, runCompute, validateFoundation } from '../../packages/deployment/src/index.js';
import { TECHNICAL_SEED_VERSION, TechnicalImplementationRuntime } from '../../packages/operations/src/index.js';

const tenant = '22222222-2222-4222-8222-222222222222';
const digest = 'a'.repeat(64);
const future = '2099-01-02T00:00:00.000Z';

async function manifest() {
  return new DeploymentDirector().deploy({
    id: 'deployment-1', environment: 'demo', expectedGeneration: 0,
    oidc: { trusted: true, subject: 'repo:protected/demo:environment' },
    artifacts: { app: digest, package: digest, migration: digest, sbom: digest, provenance: digest },
    configurationDigest: digest, configuration: { region: 'centralindia', scale: 0 }, secretReferenceVersions: ['kv://platform/provider/7'],
    resources: ['sql', 'storage', 'worker'], leaseExpiresAt: future,
    migration: { compatible: true, checkpoint: 'backup-1', backedUp: true }, checks: { health: true, contracts: true, security: true },
  });
}

describe('Azure adapter foundations through M9', () => {
  test('denies unsafe foundations and keeps compute telemetry Tenant-scoped and secret-free', async () => {
    const evidence = await validateFoundation({ tenantId: tenant, configuration: { vaultReference: 'kv://platform/provider/7' }, resources: [
      { id: 'repo', kind: 'repository', privateIngress: true, roles: ['reader'], backupCovered: true },
      { id: 'sql', kind: 'sql', privateIngress: true, roles: ['writer'], backupCovered: true },
    ], restore: { tenantId: tenant, quarantine: true, resources: ['sql'], activeStateUntouched: true } });
    expect(evidence.resourceDigest).toHaveLength(64);
    await expect(validateFoundation({ tenantId: tenant, configuration: { token: 'never' }, resources: [], restore: { tenantId: tenant, quarantine: false, resources: [], activeStateUntouched: false } })).rejects.toMatchObject({ code: 'DENIED' });

    const compute = await runCompute({ tenantId: tenant, correlationId: 'correlation-1', kind: 'extension-job', ingress: 'internal', identity: 'managed', network: [], cpuMillis: 100, diagnostics: { operation: 'reconcile', count: 1 }, costUsd: 0.01 }, () => undefined);
    expect(compute.audit).toEqual({ correlationId: 'correlation-1', outcome: 'completed' });
    await expect(runCompute({ tenantId: tenant, correlationId: 'correlation-1', kind: 'worker', ingress: 'internal', identity: 'managed', network: ['metadata'], cpuMillis: 100, diagnostics: {}, costUsd: 0 }, () => undefined)).rejects.toMatchObject({ code: 'DENIED' });
  });

  test('fences immutable delivery, proves recovery, and only closes exact lease-owned inventory', async () => {
    const deployed = await manifest();
    expect(deployed.generation).toBe(1);
    await expect(new DeploymentDirector().deploy({
      id: 'untrusted', environment: 'demo', expectedGeneration: 0, oidc: { trusted: false, subject: 'repo:fork/demo:environment' }, artifacts: { app: digest, package: digest, migration: digest, sbom: digest, provenance: digest }, configurationDigest: digest, configuration: {}, secretReferenceVersions: ['kv://platform/1'], resources: ['sql'], leaseExpiresAt: future, migration: { compatible: true, checkpoint: 'backup', backedUp: true }, checks: { health: true, contracts: true, security: true },
    })).rejects.toMatchObject({ code: 'DENIED' });
    await expect(exerciseRecovery({ manifest: deployed, tenantId: tenant, fault: 'queue', duplicateEffects: false, quarantine: true, backupTenantId: tenant, rpoMinutes: 15, rtoMinutes: 60, rollbackVectorMatches: true })).resolves.toMatchObject({ state: 'recovered' });
    await expect(exerciseRecovery({ manifest: deployed, tenantId: tenant, fault: 'data', duplicateEffects: false, quarantine: false, backupTenantId: tenant, rpoMinutes: 1, rtoMinutes: 1, rollbackVectorMatches: true })).rejects.toMatchObject({ code: 'DENIED' });

    await expect(closeEnvironment({ manifest: deployed, authorized: true, admissionDisabled: true, reconciled: true, evidenceExported: true, targets: ['foreign'], now: Date.parse('2098-01-01T00:00:00.000Z') })).rejects.toMatchObject({ code: 'DENIED' });
    const held = await closeEnvironment({ manifest: deployed, authorized: true, admissionDisabled: true, reconciled: true, evidenceExported: true, targets: deployed.resources, heldEvidence: ['audit-retention'], now: Date.parse('2098-01-01T00:00:00.000Z') });
    expect(held.state).toBe('blocked');
    await expect(closeEnvironment({ manifest: deployed, authorized: true, admissionDisabled: true, reconciled: true, evidenceExported: true, targets: deployed.resources, now: Date.parse('2098-01-01T00:00:00.000Z') })).resolves.toMatchObject({ state: 'closed', deleted: ['sql', 'storage', 'worker'] });
  });

  test('reruns the unchanged M8 fixture after delivery readiness', async () => {
    const runtime = new TechnicalImplementationRuntime();
    runtime.bootstrap({ version: TECHNICAL_SEED_VERSION });
    await runtime.seed();
    await expect(runtime.success()).resolves.toMatchObject({ label: 'fixture', outcome: 'succeeded' });
  });
});

describe('provider-neutral certification', () => {
  test('runs one fake/live suite, rejects forged live labels and unsafe recordings', async () => {
    const adapter = { provider: 'fixture', apiVersion: 'v1', authVersion: 'oauth-v1', schemaVersion: '2026-09-16', invoke: (item: 'allow' | 'deny' | 'pagination' | 'throttle' | 'idempotency' | 'timeout' | 'reconciliation' | 'credential' | 'reset') => ({ outcome: item }) };
    const harness = new ProviderCertificationHarness(() => true, () => Date.parse('2026-09-16T00:00:00.000Z'));
    await expect(harness.certify(adapter)).resolves.toMatchObject({ classification: 'fixture', cases: ['allow', 'deny', 'pagination', 'throttle', 'idempotency', 'timeout', 'reconciliation', 'credential', 'reset'] });
    await expect(harness.certify(adapter, { provider: 'fixture', apiVersion: 'v1', authVersion: 'oauth-v1', schemaVersion: '2026-09-16', classification: 'live', recordedAt: '2026-09-15T00:00:00.000Z', expiresAt: future, recording: { token: 'unsafe' } })).rejects.toMatchObject({ code: 'DENIED' });
    await expect(new ProviderCertificationHarness(() => false).certify(adapter, { provider: 'fixture', apiVersion: 'v1', authVersion: 'oauth-v1', schemaVersion: '2026-09-16', classification: 'live', recordedAt: '2026-09-15T00:00:00.000Z', expiresAt: future, recording: { receipt: 'safe-id' } })).rejects.toThrow(DeploymentError);
    await expect(harness.certify(adapter, { provider: 'fixture', apiVersion: 'v1', authVersion: 'oauth-v1', schemaVersion: '2026-09-16', classification: 'live', recordedAt: '2026-09-15T00:00:00.000Z', expiresAt: future, recording: { receipt: 'safe-id' } })).resolves.toMatchObject({ classification: 'live' });
  });
});
