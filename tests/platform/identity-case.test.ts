import { describe, expect, test } from 'vitest';

import { commandCase, createCase, decideCase, evolveCase, type CaseCommand } from '../../packages/case/src/index.js';
import { IdentityError, IdentityStore } from '../../packages/identity/src/index.js';

const tenant = '22222222-2222-4222-8222-222222222222';
const expiresAt = '2099-01-01T00:00:00.000Z';

describe('identity and case seams', () => {
  test('keeps tenant, approval, epoch, and case fences fail-closed', async () => {
    const identity = new IdentityStore();
    identity.provision(tenant); identity.transition(tenant, 1, 'activate');
    identity.mapUser('https://issuer.example', 'requester', 'user-1'); identity.mapUser('https://issuer.example', 'approver', 'user-2');
    identity.membership(tenant, 'user-1', ['operator']); identity.membership(tenant, 'user-2', ['approver']);
    identity.setMembership(tenant, 'user-1', 1, 'current'); identity.setMembership(tenant, 'user-2', 1, 'current');
    const context = identity.authenticate({ mode: 'interactive', issuer: 'https://issuer.example', subject: 'requester', audience: 'platform-browser-api', expiresAt, tokenUse: 'session', sessionId: 'session-1' }, tenant, 'platform-browser-api');
    const binding = { caseId: 'case-1', generation: 1, action: 'write', target: 'resource-1', argumentDigest: 'a'.repeat(64), requiredProfile: 'approver', risk: 'R2' as const };
    identity.requestApproval(tenant, { id: 'approval-1', ...binding, requesterId: 'user-1', approverId: 'user-2', expiresAt });
    expect((await identity.evaluateAuthority({ context, action: 'write', arguments: { value: 1 }, grants: [true, true], approval: { id: 'approval-1', binding } })).outcome).toBe('allow');
    expect((await identity.evaluateAuthority({ context, action: 'write', arguments: {}, grants: [true] })).outcome).toBe('allow');
    identity.transition(tenant, 2, 'suspend');
    expect((await identity.evaluateAuthority({ context, action: 'read', arguments: {}, grants: [true] })).outcome).toBe('deny');
    expect(() => identity.authenticate({ mode: 'interactive', issuer: 'https://issuer.example', subject: 'requester', audience: 'platform-browser-api', expiresAt, tokenUse: 'session', sessionId: 'session-1' }, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'platform-browser-api')).toThrow(IdentityError);

    let current = createCase({ id: 'case-1', tenantId: tenant, packagePin: { name: 'package', version: '1.0.0', digest: 'b'.repeat(64) } });
    const command = (name: CaseCommand['name'], version = current.version): CaseCommand => ({ id: `${name}-${String(version)}`, tenantId: current.tenantId, name, expectedGeneration: current.generation, expectedVersion: version, idempotencyKey: `${name}-${String(version)}`, argumentDigest: 'c'.repeat(64), authority: 'allow' });
    current = await commandCase(current, command('submit')); current = await commandCase(current, command('start')); current = await commandCase(current, command('succeed'));
    const receipt = await decideCase(current, command('reopen')); current = await commandCase(current, command('reopen'));
    expect(current).toMatchObject({ state: 'draft', generation: 2 }); expect(current.outcome).toBeUndefined();
    await expect(decideCase(current, { ...command('submit'), expectedGeneration: 1 })).rejects.toMatchObject({ code: 'STALE' });
    const reopeningEvent = receipt.events[0]; if (reopeningEvent === undefined) throw new Error('Expected a reopening event.');
    expect(() => evolveCase(current, { ...receipt, idempotencyKey: 'forged', events: [{ ...reopeningEvent, name: 'succeed', state: 'succeeded', generation: current.generation, version: current.version + 1 }] })).toThrow('Case command was not accepted.');
    expect(receipt.events[0]?.type).toBe('case.reopened');
  });
});
