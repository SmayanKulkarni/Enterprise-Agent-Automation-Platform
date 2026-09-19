import { expect, test } from 'vitest';
import { StudioCommandRegistry, type StudioAuthority, type StudioCommandOperations } from './studio-commands.js';
import type { BrowserCommand } from './index.js';
import type { StudioStore } from '../../lifecycle/src/studio-sql.js';

const command = (argumentsValue: Record<string, unknown>): BrowserCommand => ({ context: { mode: 'interactive', userId: '33333333-3333-4333-8333-333333333333', tenantId: '11111111-1111-4111-8111-111111111111' as BrowserCommand['context']['tenantId'], expiresAt: '2099-01-01T00:00:00.000Z', tenantEpoch: 1, membershipEpoch: 1 }, tenantId: '11111111-1111-4111-8111-111111111111', owner: 'studio', name: 'create-draft', idempotencyKey: '44444444-4444-4444-8444-444444444444', correlationId: '55555555-5555-4555-8555-555555555555', expectedVersion: 0, digest: 'a'.repeat(64), envelope: { messageId: '55555555-5555-4555-8555-555555555555' as BrowserCommand['envelope']['messageId'], contract: 'browser.v1', contractVersion: '1.0.0', occurredAt: '2026-09-18T00:00:00.000Z', sender: 'test', classification: 'restricted-operational', payload: { arguments: argumentsValue } } });
const authority: StudioAuthority = { assert: async () => undefined };
const operations = {} as StudioCommandOperations;
const store = {} as StudioStore;

test('Studio commands reject forged Tenant fields before reaching an owner service', async () => {
  const handlers = new StudioCommandRegistry(store, authority, operations).handlers();
  await expect(handlers['studio.create-draft'](command({ id: '22222222-2222-4222-8222-222222222222', tenantId: '99999999-9999-4999-8999-999999999999' }))).rejects.toMatchObject({ code: 'INVALID' });
});
