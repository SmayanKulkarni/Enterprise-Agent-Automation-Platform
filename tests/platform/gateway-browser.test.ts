import { describe, expect, test } from 'vitest';

import { BrowserV1Transport, CaseWorkbench, ClerkSessionAdapter, clerkAuthorizationHeader, liveClerkSessionAdapter } from '../../packages/browser/src/index.js';
import { CapabilityGateway, CapabilityRegistry, GatewayError, ProviderInstallationManager, signRelease, type CapabilityInvocation, type ProviderAdapter } from '../../packages/gateway/src/index.js';
import { IdentityStore } from '../../packages/identity/src/index.js';

const tenant = '22222222-2222-4222-8222-222222222222';
const foreignTenant = '33333333-3333-4333-8333-333333333333';
const now = '2099-01-01T00:00:00.000Z';

async function gateway(adapter: ProviderAdapter) {
  const registry = new CapabilityRegistry({ publisher: 'local-signing-key' });
  registry.registerDefinition({ name: 'directory.subject.read', version: '1.0.0', inputKeys: ['subject'], outputKeys: ['displayName'] });
  const unsigned = { id: 'release-1', provider: 'fake', version: '1.0.0', definitions: ['directory.subject.read'] };
  await registry.registerRelease({ ...unsigned, ...(await signRelease('publisher', 'local-signing-key', unsigned)) });
  const installations = new ProviderInstallationManager(registry, () => now);
  const installed = installations.install({ id: 'installation-1', tenantId: tenant, releaseId: 'release-1', accountId: 'account-1', callbackId: 'callback-1' });
  const healthy = installations.validate(installed.id, installed.version, { account: true, callback: true, health: true, schema: true, signature: true });
  return { gateway: new CapabilityGateway(installations, adapter, { now: () => now }), installations, healthy };
}

function invocation(overrides: Partial<CapabilityInvocation> = {}): CapabilityInvocation {
  return { id: 'request-1', tenantId: tenant, effectId: 'effect-1', attemptId: 'attempt-1', caseId: 'case-1', generation: 1, idempotencyKey: 'effect-key', capability: 'directory.subject.read', installationId: 'installation-1', accountId: 'account-1', resource: 'subject-1', operation: 'subject.read', arguments: { subject: 'subject-1' }, deadline: '2099-01-01T00:01:00.000Z', authorityCurrent: true, approvalCurrent: true, budgetRemaining: 1, ...overrides };
}

describe('browser session and capability gateway seams', () => {
  test('verifies a current Clerk session before exposing a safe Tenant shell', async () => {
    const identity = new IdentityStore(); identity.provision(tenant); identity.transition(tenant, 1, 'activate'); identity.mapUser('https://clerk.example', 'user-1', 'user-1'); identity.membership(tenant, 'user-1', ['operator']); identity.setMembership(tenant, 'user-1', 1, 'current');
    const clerk = new ClerkSessionAdapter({ issuer: 'https://clerk.example', publishableKey: 'pk_test', audience: 'platform-browser-api', authorizedParties: ['https://app.example'] }, { verifySessionToken: () => ({ issuer: 'https://clerk.example', subject: 'user-1', sessionId: 'session-1', audience: 'platform-browser-api', expiresAt: '2099-01-01T01:00:00.000Z', tokenUse: 'session', authorizedParty: 'https://app.example' }), getSession: () => ({ subject: 'user-1', status: 'active' }) });
    const browser = new BrowserV1Transport({ allowedOrigins: ['https://app.example'], clerk, identity, now: () => now });
    const response = await browser.handle({ method: 'GET', path: '/api/v1/session', headers: { authorization: 'Bearer session-token', origin: 'https://app.example' } });
    expect(response.status).toBe(200);
    expect((await browser.handle({ method: 'GET', path: '/api/v1/session', headers: { authorization: 'Bearer session-token', origin: 'https://foreign.example' } })).status).toBe(400);
    const fresh = () => Promise.resolve({ caseId: 'case-1', watermark: 3, eventSequence: 3, generation: 1, version: 3, classification: 'restricted-operational' as const, redacted: true });
    const workbench = new CaseWorkbench(); await workbench.ingest({ caseId: 'case-1', watermark: 1, eventSequence: 1, generation: 1, version: 1, classification: 'restricted-operational', redacted: true }, fresh);
    expect((await workbench.ingest({ caseId: 'case-1', watermark: 2, eventSequence: 3, generation: 1, version: 2, classification: 'restricted-operational', redacted: true }, fresh)).version).toBe(3);
  });

  test('uses the official Clerk backend seam with an exact audience and current session', async () => {
    let options: unknown; const adapter = liveClerkSessionAdapter({ CLERK_ISSUER: 'https://clerk.example', CLERK_PUBLISHABLE_KEY: 'pk_live', CLERK_SECRET_KEY: 'sk_live', CLERK_AUDIENCE: 'platform-browser-api', CLERK_AUTHORIZED_PARTIES: 'https://app.example' }, {
      verifyToken: (_token, input) => { options = input; return Promise.resolve({ iss: 'https://clerk.example', sub: 'user-1', sid: 'session-1', azp: 'https://app.example', exp: 4_070_908_800 }); }, sessions: { getSession: () => Promise.resolve({ userId: 'user-1', status: 'active' }) },
    });
    await expect(adapter.proof('short-lived-session-token', 'https://app.example')).resolves.toMatchObject({ issuer: 'https://clerk.example', subject: 'user-1', sessionId: 'session-1' });
    expect(options).toEqual({ secretKey: 'sk_live', audience: 'platform-browser-api', authorizedParties: ['https://app.example'] }); expect(await clerkAuthorizationHeader(() => Promise.resolve('short-lived-session-token'))).toEqual({ authorization: 'Bearer short-lived-session-token' });
    expect(() => liveClerkSessionAdapter({ CLERK_ISSUER: 'https://clerk.example', CLERK_PUBLISHABLE_KEY: 'pk_live', CLERK_SECRET_KEY: 'sk_live', CLERK_AUDIENCE: 'another-api', CLERK_AUTHORIZED_PARTIES: 'https://app.example' })).toThrow('Invalid Clerk browser configuration.');
    const revoked = liveClerkSessionAdapter({ CLERK_ISSUER: 'https://clerk.example', CLERK_PUBLISHABLE_KEY: 'pk_live', CLERK_SECRET_KEY: 'sk_live', CLERK_AUDIENCE: 'platform-browser-api', CLERK_AUTHORIZED_PARTIES: 'https://app.example' }, { verifyToken: () => Promise.resolve({ iss: 'https://clerk.example', sub: 'user-1', sid: 'session-1', azp: 'https://app.example', exp: 4_070_908_800 }), sessions: { getSession: () => Promise.resolve({ userId: 'user-1', status: 'revoked' }) } });
    await expect(revoked.proof('stale', 'https://app.example')).rejects.toThrow('DENIED');
  });

  test('keeps signed releases, installation callbacks and effect uncertainty fenced', async () => {
    const seen: unknown[] = []; const success: ProviderAdapter = { invoke: (input) => { seen.push(input); return { outcome: 'succeeded', output: { displayName: 'Ada' }, providerRef: 'safe-reference' }; } };
    const ready = await gateway(success); expect(ready.installations.callback({ installationId: 'installation-1', tenantId: tenant, accountId: 'account-1', callbackId: 'callback-1', cursor: 1, generation: ready.healthy.generation }).checkpoint).toBe(1);
    expect(ready.installations.discover(tenant)).toHaveLength(1); expect(ready.installations.discover(foreignTenant)).toHaveLength(0);
    await expect(ready.gateway.invoke(invocation({ tenantId: foreignTenant }))).rejects.toBeInstanceOf(GatewayError);
    expect(await ready.gateway.invoke(invocation())).toMatchObject({ outcome: 'succeeded', certainty: 'confirmed', reconciliationRequired: false });
    expect(seen[0]).toMatchObject({ operation: 'subject.read', accountId: 'account-1', resource: 'subject-1' }); expect(seen[0]).not.toHaveProperty('tenantId');
    expect(() => ready.installations.callback({ installationId: 'installation-1', tenantId: tenant, accountId: 'account-1', callbackId: 'callback-1', cursor: 1, generation: ready.healthy.generation })).toThrow(GatewayError);

    const uncertain = await gateway({ invoke: () => ({ outcome: 'unknown-outcome' }), reconcile: () => 'inconclusive' });
    expect((await uncertain.gateway.invoke(invocation())).outcome).toBe('unknown-outcome');
    await expect(uncertain.gateway.reconcile('effect-1')).resolves.toMatchObject({ state: 'operator-required', disposition: 'await-reconcile' });
  });
});
