import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { deliverWebhook, type Scheduler, type WebhookCredential, type WorkflowRun } from './service.js';
import type { PublishedDefinition, WorkflowRecord, WorkflowStore } from './sql.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const definitionId = '22222222-2222-4222-8222-222222222222';
const secret = 'test-signing-secret';
const message = (eventId: string, timestamp: string, body: Uint8Array) => Buffer.concat([Buffer.from(`${tenantId}:${definitionId}:${timestamp}:${eventId}:`), Buffer.from(body)]);

function ingress(mode: 'active' | 'missing' | 'rotated' = 'active') {
  const records = new Map<string, WorkflowRecord<WorkflowRun>>();
  const credential: WorkflowRecord<WebhookCredential> | undefined = mode === 'missing' ? undefined : { id: definitionId, kind: 'webhook-credential', version: 1, state: 'active', data: { definitionId, secret, enabled: true, rotatedAt: '2026-01-01T00:00:00.000Z', ...(mode === 'rotated' ? { previousSecret: 'rotated-secret', previousExpiresAt: '2026-01-01T00:05:00.000Z' } : {}) } };
  const definition: PublishedDefinition = { id: definitionId, draftId: '33333333-3333-4333-8333-333333333333', draftRevision: 1, digest: 'a'.repeat(64), definition: { id: definitionId, revision: 1, digest: 'a'.repeat(64), start: 'trigger', nodes: [{ id: 'trigger', kind: 'trigger', config: { mode: 'webhook', inputSchema: { type: 'object', properties: { ready: { type: 'boolean' } }, required: ['ready'], additionalProperties: false } }, next: null }], capabilityPins: [] } };
  const store = {
    workerDefinition: async (tenant: string) => tenant === tenantId ? definition : undefined,
    workerRead: async <T>(_tenant: string, kind: string, id: string) => kind === 'webhook-credential' ? credential as unknown as WorkflowRecord<T> : records.get(`${kind}:${id}`) as WorkflowRecord<T> | undefined,
    workerList: async <T>(_tenant: string, kind: string) => [...records.values()].filter((record) => record.kind === kind) as WorkflowRecord<T>[],
    workerWrite: async <T>(_tenant: string, kind: string, id: string, expectedVersion: number, state: string, data: T) => {
      const key = `${kind}:${id}`; const prior = records.get(key);
      if ((prior?.version ?? 0) !== expectedVersion) throw Object.assign(new Error('STALE'), { code: 'STALE' });
      const record: WorkflowRecord<T> = { id, kind: kind as WorkflowRecord<T>['kind'], version: expectedVersion + 1, state, data }; records.set(key, record as unknown as WorkflowRecord<WorkflowRun>); return record;
    },
  } as unknown as WorkflowStore;
  const starts: string[] = [];
  const scheduler: Scheduler = { start: async (runId) => { starts.push(runId); }, raise: async () => {} };
  return { records, store, scheduler, starts };
}

describe('webhook ingress', () => {
  test('uses the same signed ingress for accepted, malformed, stale, invalid-signature, and replayed events', async () => {
    const { records, store, scheduler, starts } = ingress();
    const eventId = randomUUID(); const timestamp = '2026-01-01T00:00:00.000Z'; const body = Buffer.from(JSON.stringify({ ready: true }));
    const signature = `sha256=${createHmac('sha256', secret).update(message(eventId, timestamp, body)).digest('hex')}`;
    await expect(deliverWebhook(store, scheduler, { tenantId, definitionId, eventId, timestamp, signature, body, now: Date.parse(timestamp) })).resolves.toEqual({ outcome: 'accepted', runId: eventId });
    await expect(deliverWebhook(store, scheduler, { tenantId, definitionId, eventId, timestamp, signature, body, now: Date.parse(timestamp) })).resolves.toEqual({ outcome: 'replay', runId: eventId });
    expect([...records.values()].filter((record) => record.kind === 'run')).toHaveLength(1); expect(starts).toEqual([eventId]);
    await expect(deliverWebhook(store, scheduler, { tenantId, definitionId, eventId: randomUUID(), timestamp, signature: `sha256=${'0'.repeat(64)}`, body, now: Date.parse(timestamp) })).resolves.toEqual({ outcome: 'signature' });
    const malformedId = randomUUID(); const malformedBody = Buffer.from('{'); const malformedSignature = `sha256=${createHmac('sha256', secret).update(message(malformedId, timestamp, malformedBody)).digest('hex')}`;
    await expect(deliverWebhook(store, scheduler, { tenantId, definitionId, eventId: malformedId, timestamp, signature: malformedSignature, body: malformedBody, now: Date.parse(timestamp) })).resolves.toEqual({ outcome: 'invalid-shape' });
    await expect(deliverWebhook(store, scheduler, { tenantId, definitionId, eventId: randomUUID(), timestamp, signature, body, now: Date.parse(timestamp) + 300001 })).resolves.toEqual({ outcome: 'freshness' });
  });

  test('rejects missing credentials and foreign tenants while accepting a signature from the five-minute rotation overlap', async () => {
    const eventId = randomUUID(); const timestamp = '2026-01-01T00:00:00.000Z'; const body = Buffer.from(JSON.stringify({ ready: true }));
    const missing = ingress('missing'); const rotated = ingress('rotated');
    const currentSignature = `sha256=${createHmac('sha256', secret).update(message(eventId, timestamp, body)).digest('hex')}`;
    await expect(deliverWebhook(missing.store, missing.scheduler, { tenantId, definitionId, eventId, timestamp, signature: currentSignature, body, now: Date.parse(timestamp) })).resolves.toEqual({ outcome: 'credential-state' });
    const previousSignature = `sha256=${createHmac('sha256', 'rotated-secret').update(message(eventId, timestamp, body)).digest('hex')}`;
    await expect(deliverWebhook(rotated.store, rotated.scheduler, { tenantId, definitionId, eventId, timestamp, signature: previousSignature, body, now: Date.parse(timestamp) })).resolves.toEqual({ outcome: 'accepted', runId: eventId });
    await expect(deliverWebhook(rotated.store, rotated.scheduler, { tenantId: '44444444-4444-4444-8444-444444444444', definitionId, eventId: randomUUID(), timestamp, signature: currentSignature, body, now: Date.parse(timestamp) })).resolves.toEqual({ outcome: 'not-found' });
  });

  test('keeps an admitted run pending when dispatch fails and recovers it without replacing the run', async () => {
    const { store, starts } = ingress();
    const eventId = randomUUID(); const timestamp = '2026-01-01T00:00:00.000Z'; const body = Buffer.from(JSON.stringify({ ready: true }));
    const signature = `sha256=${createHmac('sha256', secret).update(message(eventId, timestamp, body)).digest('hex')}`;
    const unavailable: Scheduler = { start: async () => { throw new Error('unavailable'); }, raise: async () => {} };
    await expect(deliverWebhook(store, unavailable, { tenantId, definitionId, eventId, timestamp, signature, body, now: Date.parse(timestamp) })).resolves.toEqual({ outcome: 'accepted', runId: eventId });
    const { recoverWebhookDispatch } = await import('./service.js');
    await expect(recoverWebhookDispatch(store, { start: async (runId) => { starts.push(runId); }, raise: async () => {} }, tenantId)).resolves.toBe(1);
    expect(starts).toEqual([eventId]);
  });
});
