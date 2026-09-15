import { describe, expect, test } from 'vitest';

import {
  CapabilityRegistry,
  CredentialBroker,
  DisposableLocalExtensionRunner,
  FakeSecretStore,
  GatewayError,
  ProviderInstallationManager,
  ProviderLifecycle,
  signRelease,
} from '../../packages/gateway/src/index.js';
import {
  InMemoryMemoryStore,
  ProvenanceGraph,
  RelationalMemoryStore,
  retrieveMemory,
  type MemoryQuery,
} from '../../packages/memory/src/index.js';

const tenant = '22222222-2222-4222-8222-222222222222';
const foreignTenant = '33333333-3333-4333-8333-333333333333';
const now = '2099-01-01T00:00:00.000Z';
const later = '2099-01-01T01:00:00.000Z';

async function installation() {
  const registry = new CapabilityRegistry({ publisher: 'local-signing-key' });
  registry.registerDefinition({ name: 'directory.subject.read', version: '1.0.0', inputKeys: ['subject'], outputKeys: ['displayName'] });
  for (const version of ['1.0.0', '1.1.0']) {
    const unsigned = { id: `release-${version}`, provider: 'fake', version, definitions: ['directory.subject.read'] };
    await registry.registerRelease({ ...unsigned, ...(await signRelease('publisher', 'local-signing-key', unsigned)) });
  }
  const installations = new ProviderInstallationManager(registry, () => now);
  const pending = installations.install({ id: 'installation-1', tenantId: tenant, releaseId: 'release-1.0.0', accountId: 'account-1', callbackId: 'callback-1' });
  return { manager: installations, installation: installations.validate(pending.id, pending.version, { account: true, callback: true, health: true, schema: true, signature: true }) };
}

describe('provider lifecycle and governed memory seams', () => {
  test('keeps credential material invocation-local and fences extension execution and installation readiness', async () => {
    const secrets = new FakeSecretStore();
    const credentials = new CredentialBroker(secrets, () => now);
    const credential = credentials.consent({ id: 'credential-1', tenantId: tenant, installationId: 'installation-1', accountId: 'account-1', scopes: ['directory.subject.read'], expiresAt: later, consented: true }, 'token-v1');
    expect(credential).not.toHaveProperty('token');
    expect(credentials.acquire({ tenantId: tenant, installationId: 'installation-1', scope: 'directory.subject.read', authorityCurrent: true }).token).toBe('token-v1');
    expect(() => credentials.acquire({ tenantId: tenant, installationId: 'installation-1', scope: 'directory.subject.write', authorityCurrent: true })).toThrow(GatewayError);
    await credentials.rotate('credential-1', credential.version, 'token-v2', later, (candidate) => candidate.token === 'token-v2');
    credentials.revoke('credential-1');
    expect(() => credentials.acquire({ tenantId: tenant, installationId: 'installation-1', scope: 'directory.subject.read', authorityCurrent: true })).toThrow(GatewayError);

    const runner = new DisposableLocalExtensionRunner(() => now);
    await expect(runner.run({ tenantId: tenant, packageDigest: 'a'.repeat(64), capability: 'directory.subject.read', input: { subject: 'subject-1' }, deadline: later, policy: { maxBytes: 64, network: [], resources: ['directory.subject.read'] } }, ({ input }) => ({ displayName: input['subject'], dlpSafe: false }))).rejects.toBeInstanceOf(GatewayError);
    expect((await runner.run({ tenantId: tenant, packageDigest: 'a'.repeat(64), capability: 'directory.subject.read', input: { subject: 'subject-1' }, deadline: later, policy: { maxBytes: 64, network: [], resources: ['directory.subject.read'] } }, ({ input }) => ({ displayName: input['subject'] }))).output).toEqual({ displayName: 'subject-1' });

    const ready = await installation();
    const lifecycle = new ProviderLifecycle(ready.manager, credentials);
    expect(lifecycle.readiness(ready.installation.id, 'credential-1')).toMatchObject({ ready: false, reason: 'credential-revoked' });
    const replacement = credentials.consent({ id: 'credential-2', tenantId: tenant, installationId: ready.installation.id, accountId: 'account-1', scopes: ['directory.subject.read'], expiresAt: later, consented: true }, 'token-v3');
    expect(credentials.acquire({ tenantId: tenant, installationId: ready.installation.id, scope: 'directory.subject.read', authorityCurrent: true }).token).toBe('token-v3');
    const upgraded = lifecycle.upgrade(ready.installation.id, ready.installation.version, 'release-1.1.0', { health: true, schema: true, signature: true }, replacement.id);
    expect(upgraded.releaseId).toBe('release-1.1.0');
    expect(lifecycle.readiness(ready.installation.id, replacement.id)).toMatchObject({ ready: true, credentialEpoch: 1 });
    expect(lifecycle.remove(ready.installation.id, upgraded.version, replacement.id, true).state).toBe('removed');
  });

  test('pre-filters governed records before ranking and makes corrected provenance ineligible everywhere', async () => {
    const graph = new ProvenanceGraph();
    const source = graph.add({ id: 'source-1', tenantId: tenant, scope: { kind: 'tenant', tenantId: tenant }, purpose: 'knowledge', classification: 'ordinary', legalBasis: 'contract', retention: 'standard', locations: ['memory://primary'], transformation: 'ingest', digest: 'a'.repeat(64) });
    const derivative = graph.add({ id: 'derivative-1', tenantId: tenant, scope: { kind: 'tenant', tenantId: tenant }, purpose: 'knowledge', classification: 'ordinary', legalBasis: 'contract', retention: 'standard', locations: ['memory://primary'], transformation: 'summarize', parents: [source.id], digest: 'b'.repeat(64) });
    const primary = new InMemoryMemoryStore(graph, () => now);
    const secondary = new RelationalMemoryStore(graph, () => now);
    const write = { id: 'record-1', tenantId: tenant, scope: { kind: 'tenant' as const, tenantId: tenant }, purpose: 'knowledge', provenanceId: derivative.id, classification: 'ordinary' as const, content: 'approved fact', authorityCurrent: true, consentCurrent: true, policyCurrent: true, retentionCurrent: true };
    primary.write(write); secondary.write(write);
    expect(() => { primary.write({ ...write, id: 'foreign-record', tenantId: foreignTenant }); }).toThrow();
    const query: MemoryQuery = { tenantId: tenant, scopes: [write.scope], purpose: 'knowledge', authorityCurrent: true, maxItems: 1, maxTokens: 8 };
    expect((await retrieveMemory(query, [primary, secondary])).items).toHaveLength(1);
    primary.unavailable = true;
    expect((await retrieveMemory(query, [primary, secondary])).quality).toBe('reduced');
    graph.status(source.id, 'corrected');
    expect((await retrieveMemory(query, [secondary])).items).toHaveLength(0);
  });
});
