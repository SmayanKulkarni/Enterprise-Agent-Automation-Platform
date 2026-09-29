import { expect, test, vi } from 'vitest';
import type { ExecutionContext } from '../../identity/src/index.js';
import { AzureSqlStudioStore, studioRecord, type CommandReceipt, type StudioStore } from './studio-sql.js';

const pool = vi.hoisted(() => ({ calls: [] as { procedure: string; inputs: Record<string, unknown> }[], rows: [] as Record<string, unknown>[], failure: undefined as { number: number } | undefined }));
vi.mock('../../identity/src/sql-pool.js', () => ({
  sqlPool: async () => ({ request: () => { const inputs: Record<string, unknown> = {}; const request = { input: (name: string, _type: unknown, value: unknown) => { inputs[name] = value; return request; }, execute: async (procedure: string) => { pool.calls.push({ procedure, inputs }); if (pool.failure) throw Object.assign(new Error('sql'), pool.failure); return { recordset: pool.rows }; } }; return request; } }),
}));


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

test('maps the string a SQL bigint revision arrives as and rejects non-integers', () => {
  const row = { id: '22222222-2222-4222-8222-222222222222', tenant_id: '11111111-1111-4111-8111-111111111111', state: 'draft', digest: 'a'.repeat(64), author_id: '33333333-3333-4333-8333-333333333333', draft_json: JSON.stringify({ id: 'package' }), created_at: new Date('2026-09-18T00:00:00.000Z') };
  expect(studioRecord({ ...row, revision: '7' })).toMatchObject({ revision: 7 });
  expect(() => studioRecord({ ...row, revision: '1.5' })).toThrow();
  expect(() => studioRecord({ ...row, revision: '9007199254740993' })).toThrow();
});

test('lists every saved revision of one draft through the tenant-fenced procedure, newest first', async () => {
  const row = (revision: number) => ({ id: '22222222-2222-4222-8222-222222222222', tenant_id: '11111111-1111-4111-8111-111111111111', revision: String(revision), state: 'draft', digest: 'a'.repeat(64), author_id: '33333333-3333-4333-8333-333333333333', draft_json: JSON.stringify({ kind: 'graph-v1', nodes: [], edges: [], revision }), created_at: new Date('2026-09-18T00:00:00.000Z') });
  pool.calls.length = 0; pool.failure = undefined; pool.rows = [row(3), row(2), row(1)];
  const context = { tenantId: '11111111-1111-4111-8111-111111111111', userId: '44444444-4444-4444-8444-444444444444', tenantEpoch: 1, membershipEpoch: 2 } as unknown as ExecutionContext;
  const revisions = await new AzureSqlStudioStore('Server=test').revisions(context, '22222222-2222-4222-8222-222222222222');
  expect(revisions.map((item) => item.revision)).toEqual([3, 2, 1]);
  expect(revisions[0]?.draft).toMatchObject({ kind: 'graph-v1', revision: 3 });
  expect(Object.isFrozen(revisions)).toBe(true);
  expect(pool.calls).toEqual([{ procedure: 'studio.list_revisions', inputs: { tenant_id: context.tenantId, user_id: context.userId, tenant_epoch: 1, membership_epoch: 2, draft_id: '22222222-2222-4222-8222-222222222222' } }]);
});

test('an unknown draft yields no revisions and a non-member is denied', async () => {
  const context = { tenantId: '11111111-1111-4111-8111-111111111111', userId: '44444444-4444-4444-8444-444444444444', tenantEpoch: 1, membershipEpoch: 2 } as unknown as ExecutionContext;
  const store = new AzureSqlStudioStore('Server=test');
  pool.failure = undefined; pool.rows = [];
  expect(await store.revisions(context, '22222222-2222-4222-8222-222222222222')).toEqual([]);
  pool.failure = { number: 50001 };
  await expect(store.revisions(context, '22222222-2222-4222-8222-222222222222')).rejects.toMatchObject({ code: 'DENIED' });
  pool.failure = undefined;
});
