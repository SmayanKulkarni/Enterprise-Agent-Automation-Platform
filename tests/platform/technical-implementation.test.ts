import { describe, expect, test } from 'vitest';

import { BrowserV1Transport, ClerkSessionAdapter } from '../../packages/browser/src/index.js';
import { encodeContract, descriptorFor, messageId, tenantId, type ContractEnvelope } from '../../packages/contracts/src/index.js';
import { IdentityStore } from '../../packages/identity/src/index.js';
import { TECHNICAL_SEED_VERSION, TECHNICAL_TENANTS, TechnicalImplementationError, TechnicalImplementationRuntime, validateInfrastructurePlan } from '../../packages/operations/src/index.js';

const now = '2099-01-01T00:00:00.000Z';
const correlation = '11111111-1111-4111-8111-111111111111';

describe('Technical Implementation M8 fixture and Azure policy shell', () => {
  test('runs the two-Tenant fixture through success, recovery, reset, browser commands and repeatability', async () => {
    const runtime = new TechnicalImplementationRuntime();
    expect(() => { runtime.bootstrap({ version: TECHNICAL_SEED_VERSION, unmanaged: ['foreign-object'] }); }).toThrow(TechnicalImplementationError);
    runtime.bootstrap({ version: TECHNICAL_SEED_VERSION });
    const ready = await runtime.seed();
    expect(runtime.ready()).toBe(ready); expect(ready.tenants.map((item) => String(item.tenantId))).toEqual(TECHNICAL_TENANTS);
    await expect(runtime.seed('0.0.0')).rejects.toMatchObject({ code: 'STALE' });
    const success = await runtime.success(); const negative = await runtime.negatives();
    expect(success.effects.every((effect) => effect.outcome === 'succeeded' && effect.reconciliation === 'resolved')).toBe(true);
    expect(negative.steps.every((step) => step.label === 'simulated-failure')).toBe(true);
    expect((await runtime.reset({ held: true })).state).toBe('blocked'); expect((await runtime.reset({ interrupt: true })).state).toBe('resume-required'); expect((await runtime.reset({ resume: true })).residual).toEqual([]);
    const repeated = await runtime.repeat(); expect(repeated.equal).toBe(true); expect(repeated.reset.residual).toEqual([]);

    const identity = new IdentityStore(); identity.provision(TECHNICAL_TENANTS[0]); identity.transition(TECHNICAL_TENANTS[0], 1, 'activate'); identity.mapUser('https://issuer.example', 'operator', 'operator-1'); identity.membership(TECHNICAL_TENANTS[0], 'operator-1', ['operator']); identity.setMembership(TECHNICAL_TENANTS[0], 'operator-1', 1, 'current');
    const clerk = new ClerkSessionAdapter({ issuer: 'https://issuer.example', publishableKey: 'pk_fixture', audience: 'platform-browser-api', authorizedParties: ['https://app.example'] }, { verifySessionToken: () => ({ issuer: 'https://issuer.example', subject: 'operator', sessionId: 'session-1', audience: 'platform-browser-api', expiresAt: '2099-01-02T00:00:00.000Z', tokenUse: 'session', authorizedParty: 'https://app.example' }), getSession: () => ({ subject: 'operator', status: 'active' }) });
    const transport = new BrowserV1Transport({ allowedOrigins: ['https://app.example'], clerk, identity, commands: runtime.browserCommands(), now: () => now });
    const envelope: ContractEnvelope = { messageId: messageId(correlation), contract: 'browser.v1', contractVersion: '1.0.0', occurredAt: now, sender: 'fixture-browser', tenantId: tenantId(TECHNICAL_TENANTS[0]), classification: 'restricted-operational', payload: { expectedVersion: 0, arguments: { seedVersion: TECHNICAL_SEED_VERSION } } };
    const request = { method: 'POST' as const, path: `/api/v1/tenants/${TECHNICAL_TENANTS[0]}/commands/case/run`, headers: { authorization: 'Bearer fixture-session', origin: 'https://app.example', 'content-type': 'application/vnd.platform.browser.v1+json', 'idempotency-key': 'technical-browser-run', 'x-correlation-id': correlation, 'if-match': '0' }, body: (await encodeContract(descriptorFor('browser.v1'), envelope)).bytes };
    expect((await transport.handle(request)).status).toBe(200);
    expect((await transport.handle({ ...request, body: (await encodeContract(descriptorFor('browser.v1'), { ...envelope, payload: { expectedVersion: 0, arguments: { seedVersion: 'stale' } } })).bytes })).status).toBe(400);
  });

  test('fails closed before an Azure adapter sees an out-of-policy plan', async () => {
    const plan = { environment: 'demo', region: 'centralindia', resourceGroup: 'rg-demo', lease: { id: 'lease-1', owner: 'platform', expiresAt: '2099-01-02T00:00:00.000Z' }, resources: [{ id: 'storage', type: 'Microsoft.Storage/storageAccounts' as const, sku: 'Standard_LRS', tags: { environment: 'demo', lease: 'lease-1', owner: 'platform' }, rbacScope: 'resource-group' as const, networkScope: 'private' as const }], estimatedCostUsd: 1, budgetUsd: 20 };
    expect((await validateInfrastructurePlan(plan)).allowed).toBe(true);
    expect((await validateInfrastructurePlan({ ...plan, region: 'westus', destructiveTargets: ['unknown'] })).decisions).toEqual(['DESTRUCTIVE_TARGET_DENIED', 'REGION_DENIED']);
    expect(new TechnicalImplementationError('DENIED').code).toBe('DENIED');
  });
});
