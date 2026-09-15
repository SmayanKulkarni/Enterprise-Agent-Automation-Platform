import { describe, expect, test } from 'vitest';

import { BrowserV1Transport } from '../../packages/browser/src/index.js';
import { decodeContract, descriptorFor, messageId, tenantId, type ContractEnvelope } from '../../packages/contracts/src/index.js';
import { AgentTeamRuntime, EffectIntentRuntime, InMemoryCaseWorkflow, InterventionRuntime, RecoveryRuntime, type CaseCommand } from '../../packages/case/src/index.js';

const tenant = '22222222-2222-4222-8222-222222222222';
const correlation = '11111111-1111-4111-8111-111111111111';
const now = '2099-01-01T00:00:00.000Z';

describe('durable runtime and browser boundary', () => {
  test('records only durable work and fails closed at every shared fence', async () => {
    const workflow = new InMemoryCaseWorkflow(); workflow.start({ id: 'case-1', tenantId: tenant, packagePin: { name: 'package', version: '1.0.0', digest: 'a'.repeat(64) } });
    const command = (name: CaseCommand['name'], version: number): CaseCommand => ({ id: `${name}-${String(version)}`, tenantId: tenant as CaseCommand['tenantId'], name, expectedGeneration: 1, expectedVersion: version, idempotencyKey: `${name}-${String(version)}`, argumentDigest: 'b'.repeat(64), authority: 'allow' });
    await workflow.command('case-1', command('submit', 0)); await workflow.command('case-1', command('start', 1));
    let activityCalls = 0; expect(await workflow.activity('case-1', { generation: 1, version: 2 }, 'model-1', 'model', () => ++activityCalls)).toBe(1);
    expect(await workflow.activity('case-1', { generation: 1, version: 2 }, 'model-1', 'model', () => ++activityCalls)).toBe(1); expect(activityCalls).toBe(1);
    const intervention = new InterventionRuntime();
    for (const type of ['information-request', 'approval-request', 'correction', 'operator-recovery', 'break-glass'] as const) {
      intervention.open({ id: type, tenantId: tenant as CaseCommand['tenantId'], caseId: 'case-1', generation: 1, version: 2, type, responders: ['operator'], join: { kind: 'first-valid' }, deadline: now, argumentDigest: 'c'.repeat(64) });
      expect(intervention.respond({ id: `${type}-response`, requestId: type, responderId: 'operator', idempotencyKey: type, content: { type }, contentDigest: 'd'.repeat(64), authorized: true, at: now }, { tenantId: tenant as CaseCommand['tenantId'], generation: 1, version: 2 })).toMatchObject({ completed: true });
    }
    const team = new AgentTeamRuntime({ roles: ['researcher', 'reviewer'], join: { kind: 'all' }, maxDepth: 0, budget: 2 });
    team.schedule({ id: 'a', role: 'researcher', goalDigest: 'e'.repeat(64), depth: 0, reserved: 1 }); team.schedule({ id: 'b', role: 'reviewer', goalDigest: 'f'.repeat(64), depth: 0, reserved: 1 });
    team.complete({ assignmentId: 'a', digest: '1'.repeat(64), valid: true, cost: 1 }); expect(team.complete({ assignmentId: 'b', digest: '2'.repeat(64), valid: true, cost: 1 })).toEqual({ closed: true, late: false });
    const recovery = new RecoveryRuntime(); recovery.pause('case-1'); expect(() => { recovery.assertSchedulable('case-1'); }).toThrow('Runtime request was not accepted.'); recovery.resume('case-1', true);
    const effects = new EffectIntentRuntime(); let approvals = 0;
    const intent = { id: 'effect-1', tenantId: tenant, caseId: 'case-1', generation: 1, version: 2, idempotencyKey: 'effect-key', approvalId: 'approval-1', payload: { resource: 'safe' } };
    expect((await effects.record(intent, { tenantId: tenant as CaseCommand['tenantId'], generation: 1, version: 2, authority: 'allow' }, () => { approvals += 1; })).duplicate).toBe(false);
    expect((await effects.record(intent, { tenantId: tenant as CaseCommand['tenantId'], generation: 1, version: 2, authority: 'allow' }, () => { approvals += 1; })).duplicate).toBe(true); expect(approvals).toBe(1);

    const browser = new BrowserV1Transport({ allowedOrigins: ['https://app.example'], now: () => now, commands: { 'case.start': (input) => ({ receipt: input.idempotencyKey, digest: input.digest }) } });
    const envelope: ContractEnvelope = { messageId: messageId(correlation), contract: 'browser.v1', contractVersion: '1.0.0', occurredAt: now, sender: 'browser-client', tenantId: tenantId(tenant), classification: 'restricted-operational', payload: { expectedVersion: 2, arguments: { resource: 'safe' } } };
    const response = await browser.handle({ method: 'POST', path: `/api/v1/tenants/${tenant}/commands/case/start`, headers: { authorization: 'Bearer session-proof', origin: 'https://app.example', 'content-type': 'application/vnd.platform.browser.v1+json', 'idempotency-key': 'browser-key', 'x-correlation-id': correlation, 'if-match': '2' }, body: new TextEncoder().encode(JSON.stringify(envelope)) });
    expect(response.status).toBe(200); expect(decodeContract(descriptorFor('browser.v1'), response.body).payload).toMatchObject({ receipt: 'browser-key' });
    expect((await browser.handle({ method: 'GET', path: `/api/v1/tenants/${tenant}/events`, headers: { origin: 'https://app.example' } })).status).toBe(501);
  });
});
