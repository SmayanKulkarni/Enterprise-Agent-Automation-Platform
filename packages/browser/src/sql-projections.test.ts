import { expect, test } from 'vitest';
import { projectSnapshot } from './sql-projections.js';
import type { BrowserProjection } from './index.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const input: BrowserProjection = { context: { mode: 'interactive', userId: id, tenantId: tenant as BrowserProjection['context']['tenantId'], expiresAt: '2099-01-01T00:00:00.000Z', tenantEpoch: 2, membershipEpoch: 3 }, collection: 'cases' };
const row = { records_json: JSON.stringify([{ id, title: 'Persisted case' }]), watermark: 7, completeness: 'full' as const, classification: 'restricted-operational' as const, redaction: 'none' as const, published_at: new Date('2026-09-18T00:00:00.000Z'), expires_at: new Date('2026-09-19T00:00:00.000Z') };

test('projects persisted records with honest freshness and rejects unsafe or foreign data', () => {
  expect(projectSnapshot(input, row, new Date('2026-09-18T12:00:00.000Z'))).toMatchObject({ completeness: 'full', watermark: 7, records: [{ id, title: 'Persisted case', freshness: 'current' }] });
  expect(projectSnapshot({ ...input, id: '33333333-3333-4333-8333-333333333333' }, row)['records']).toEqual([]);
  expect(projectSnapshot(input, row, new Date('2026-09-20T00:00:00.000Z'))).toMatchObject({ completeness: 'partial', freshness: 'stale' });
  expect(projectSnapshot(input, undefined)).toMatchObject({ records: [], completeness: 'not-ready', freshness: 'unknown' });
  expect(() => projectSnapshot(input, { ...row, records_json: JSON.stringify([{ id, tenantId: '33333333-3333-4333-8333-333333333333' }]) })).toThrow('UNSAFE_PROJECTION');
  expect(() => projectSnapshot(input, { ...row, records_json: JSON.stringify([{ id, secret: 'do not expose' }]) })).toThrow('UNSAFE_PROJECTION');
});
