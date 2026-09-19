import { expect, test } from 'vitest';
import { studioRecord, type CommandReceipt, type StudioStore } from './studio-sql.js';

class ReceiptProbe implements Pick<StudioStore, 'rememberCommand'> {
  readonly #receipts = new Map<string, { requestDigest: string; receipt: CommandReceipt }>();
  async rememberCommand(tenantId: string, key: string, requestDigest: string, receipt: CommandReceipt): Promise<CommandReceipt> {
    const id = `${tenantId}:${key}`; const existing = this.#receipts.get(id);
    if (existing === undefined) { this.#receipts.set(id, { requestDigest, receipt }); return receipt; }
    if (existing.requestDigest !== requestDigest) throw Object.assign(new Error('CONFLICT'), { code: 'CONFLICT' });
    return existing.receipt;
  }
}

test('the Studio store port replays an identical command and rejects a reused key', async () => {
  const store = new ReceiptProbe();
  const receipt: CommandReceipt = { commandId: 'command-1', objectId: '22222222-2222-4222-8222-222222222222', revision: 1, state: 'draft', digest: 'a'.repeat(64), evidenceIds: [] };
  await expect(store.rememberCommand('11111111-1111-4111-8111-111111111111', 'key-1', 'a'.repeat(64), receipt)).resolves.toEqual(receipt);
  await expect(store.rememberCommand('11111111-1111-4111-8111-111111111111', 'key-1', 'a'.repeat(64), { ...receipt, commandId: 'different' })).resolves.toEqual(receipt);
  await expect(store.rememberCommand('11111111-1111-4111-8111-111111111111', 'key-1', 'b'.repeat(64), receipt)).rejects.toMatchObject({ code: 'CONFLICT' });
});

test('maps an Azure SQL revision row without trusting driver date formatting', () => {
  expect(studioRecord({ id: '22222222-2222-4222-8222-222222222222', tenant_id: '11111111-1111-4111-8111-111111111111', revision: 1, state: 'draft', digest: 'a'.repeat(64), author_id: '33333333-3333-4333-8333-333333333333', draft_json: JSON.stringify({ id: 'package' }), created_at: new Date('2026-09-18T00:00:00.000Z') })).toMatchObject({ revision: 1, createdAt: '2026-09-18T00:00:00.000Z' });
});
