import { describe, expect, test } from 'vitest';

import { OperationsRuntime, MongoOperationsReadModel, OperationsWorkbench, technicalImplementationFixture } from '../../packages/operations/src/index.js';
import { causationId, correlationId, encodeContract, descriptorFor, messageId, tenantId, type ContractEnvelope } from '../../packages/contracts/src/index.js';
import { LifecycleError, SolutionLifecycle } from '../../packages/lifecycle/src/index.js';
import { PackageWorkbench } from '../../packages/browser/src/index.js';

const tenant = '22222222-2222-4222-8222-222222222222';
const foreignTenant = '33333333-3333-4333-8333-333333333333';
const now = '2099-01-01T00:00:00.000Z';

async function event(id: string, sequence: number, projection: Record<string, unknown>, selectedTenant = tenant): Promise<Uint8Array> {
  const envelope: ContractEnvelope = { messageId: messageId(id), contract: 'operations.event', contractVersion: '1.0.0', occurredAt: now, tenantId: tenantId(selectedTenant), correlationId: correlationId('11111111-1111-4111-8111-111111111111'), causationId: causationId('11111111-1111-4111-8111-111111111111'), sender: 'case-runtime', classification: 'restricted-operational', payload: { ownerSequence: sequence, safeProjection: projection, evidenceId: `evidence-${String(sequence)}` } };
  return (await encodeContract(descriptorFor('operations.event'), envelope)).bytes;
}

describe('package change lifecycle and operations seams', () => {
  test('upgrades only new Cases, checkpoints migration, rolls back and quarantines', async () => {
    const lifecycle = new SolutionLifecycle();
    const first = lifecycle.author({ id: 'technical', version: '1.0.0', author: 'author', artifacts: [{ id: 'workflow', version: '1', digest: 'a'.repeat(64), kind: 'workflow', content: { stages: ['start'] } }], dependencies: [], bindings: ['provider-ref'], overlayPaths: ['/budget'] });
    const resolved = await lifecycle.resolve(first.id, first.version, { '/budget': 1 });
    await lifecycle.validate(resolved.digest, { hardPassed: true, evidenceCurrent: true, comparable: true, liveCertified: true, subjectDigest: resolved.digest });
    const publication = await lifecycle.publish({ packageDigest: resolved.digest, approver: 'approver', signer: 'signer', publisher: 'publisher', keyId: 'key-1', tenantIds: [tenant] });
    const readiness = await lifecycle.install({ id: 'install-1', tenantId: tenant, packageDigest: publication.digest, epochs: { policy: 1 }, checksCurrent: true });
    const active = lifecycle.activate({ idempotencyKey: 'activate-1', id: 'activation-1', tenantId: tenant, installationId: 'install-1', readinessDigest: readiness.digest, expectedVersion: 1 });
    const change = lifecycle.changeActivation({ id: 'upgrade-1', tenantId: tenant, fromActivationId: active.id, toActivationId: active.id, expectedRevision: active.revision, migration: { id: 'migration-1', reversible: true, compatible: true, checkpoint: 'backup-1' }, runningCaseDisposition: 'pin-current' });
    expect(change.state).toBe('upgraded');
    expect(lifecycle.active(tenant).id).toBe(active.id);
    expect(lifecycle.migration('migration-1', 'backup-1').state).toBe('completed');
    expect(lifecycle.rollback({ id: 'rollback-1', tenantId: tenant, activationId: active.id, expectedRevision: change.revision, runningCaseDisposition: 'pin-current' }).state).toBe('rolled-back');
    expect(lifecycle.quarantine(resolved.digest, 'compromised').state).toBe('quarantined');
    expect(() => lifecycle.pin(active.id, tenant)).toThrow(LifecycleError);
  });

  test('quarantines unsafe duplicate events and gives both projection adapters the same Tenant-safe DTO', async () => {
    const operations = new OperationsRuntime(() => now);
    const first = await event('11111111-1111-4111-8111-111111111112', 1, { caseId: 'case-1', state: 'running' });
    const second = await event('11111111-1111-4111-8111-111111111113', 3, { caseId: 'case-2', state: 'waiting' });
    expect(operations.ingest(first).state).toBe('accepted');
    expect(operations.ingest(first).state).toBe('duplicate');
    expect(operations.ingest(second).state).toBe('accepted');
    const unsafe = await event('11111111-1111-4111-8111-111111111114', 2, { token: 'never-visible' });
    expect(operations.ingest(unsafe).state).toBe('quarantined');
    expect(operations.quarantine()).toEqual([{ code: 'UNSAFE_PROJECTION', eventId: '11111111-1111-4111-8111-111111111114', tenantId: tenant }]);
    const projection = operations.query({ tenantId: tenant });
    expect(projection.completeness).toBe('partial');
    expect(() => operations.query({ tenantId: foreignTenant })).toThrow();
    const mongo = new MongoOperationsReadModel(); mongo.rebuild(operations, tenant);
    expect(mongo.query({ tenantId: tenant })).toEqual(projection);

    const workbench = new OperationsWorkbench();
    expect(workbench.ingest(projection).completeness).toBe('partial');
    expect(() => workbench.command({ owner: 'case', name: 'cancel', expectedVersion: 1, idempotencyKey: 'x', approvalCurrent: false, arguments: {} })).toThrow();
    const packages = new PackageWorkbench();
    packages.ingest({ tenantId: tenant, collection: 'packages', completeness: 'full', version: '1.0.0', records: [{ id: 'technical', digest: 'a'.repeat(64), readiness: 'ready' }] });
    expect(packages.draft({ tenantId: tenant, values: { name: 'technical' }, schemaKeys: ['name'] }).accepted).toBe(true);
    expect(packages.command({ name: 'quarantine', expectedVersion: 1, exactVersion: '1.0.0', approvalCurrent: true, idempotencyKey: 'package-1', arguments: { manifest: ['technical'] } }).name).toBe('quarantine');
  });

  test('keeps audit and unknown cost separate from owner command receipts and uses the shared technical package lifecycle', async () => {
    const operations = new OperationsRuntime(() => now);
    operations.audit({ tenantId: tenant, id: 'audit-1', classification: 'immutable-audit', correlationId: '11111111-1111-4111-8111-111111111111', action: 'case.cancel' });
    operations.cost({ tenantId: tenant, id: 'cost-1', basis: 'unknown', currency: 'USD', rateVersion: 'rates-1' });
    const receipt = operations.submitOwnerCommand({ tenantId: tenant, owner: 'case', name: 'cancel', idempotencyKey: 'command-1', digest: 'a'.repeat(64), expectedVersion: 1, authorityCurrent: true, approvalCurrent: true }, () => ({ ownerReceipt: 'owner-1', state: 'committed' }));
    expect(operations.submitOwnerCommand({ tenantId: tenant, owner: 'case', name: 'cancel', idempotencyKey: 'command-1', digest: 'a'.repeat(64), expectedVersion: 1, authorityCurrent: true, approvalCurrent: true }, () => ({ ownerReceipt: 'wrong' }))).toEqual(receipt);
    expect(operations.query({ tenantId: tenant }).cost).toEqual({ basis: 'unknown', currency: 'USD', rateVersion: 'rates-1' });
    expect(operations.evaluateAlerts({ tenantId: tenant, alertId: 'lag', threshold: 1, value: 2, runbook: 'runbook://lag/v1' }).state).toBe('fired');
    const fixture = await technicalImplementationFixture(tenant);
    expect(fixture.activation.packageDigest).toHaveLength(64);
  });
});
