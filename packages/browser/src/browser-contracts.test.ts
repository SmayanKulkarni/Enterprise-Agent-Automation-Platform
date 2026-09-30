import { describe, expect, test } from 'vitest';

import { BrowserContractError, decodeActionHint, decodeCommandArguments, decodeProjection, decodeReceipt } from './browser-contracts.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const objectId = '22222222-2222-4222-8222-222222222222';

describe('browser contracts', () => {
  test('accepts only exact, Tenant-scoped safe DTOs', () => {
    expect(decodeActionHint({ owner: 'studio', name: 'submit', objectId, expectedVersion: 0, risk: 'R1', approvalRequired: false })).toMatchObject({ objectId });
    expect(decodeCommandArguments('studio', 'submit', { id: objectId })).toEqual({ id: objectId });
    expect(decodeProjection({ tenantId, collection: 'cases', records: [{ id: objectId, title: 'Safe display name' }], completeness: 'full', classification: 'restricted-operational', freshness: 'current', redaction: 'none' }, tenantId, 'cases').records).toHaveLength(1);
    expect(decodeReceipt({ commandId: objectId, objectId, owner: 'studio', name: 'submit', state: 'committed', version: 1, watermark: 2, affectedCollections: ['cases'], evidenceIds: [objectId], digest: 'a'.repeat(64) })).toMatchObject({ state: 'committed' });
    expect(decodeCommandArguments('workflow', 'provision-webhook-credential', { id: objectId })).toEqual({ id: objectId });
    expect(decodeCommandArguments('workflow', 'test-webhook', { id: objectId, input: { ready: true } })).toEqual({ id: objectId, input: { ready: true } });
  });

  test('rejects unknown fields, forged scopes, secrets, unsupported commands, and invalid versions', () => {
    expect(() => decodeActionHint({ owner: 'studio', name: 'submit', objectId, expectedVersion: 0, risk: 'R1', approvalRequired: false, tenantId })).toThrow(BrowserContractError);
    expect(() => decodeCommandArguments('studio', 'submit', { id: objectId, secret: 'nope' })).toThrow(BrowserContractError);
    expect(() => decodeCommandArguments('studio', 'submit', { id: 'readable-id' })).toThrow(BrowserContractError);
    expect(() => decodeCommandArguments('vendor', 'publish', {})).toThrow(BrowserContractError);
    expect(() => decodeProjection({ tenantId: '33333333-3333-4333-8333-333333333333', collection: 'cases', records: [], completeness: 'full', classification: 'restricted-operational', freshness: 'current', redaction: 'none' }, tenantId, 'cases')).toThrow(BrowserContractError);
    expect(() => decodeProjection({ tenantId, collection: 'cases', records: [{ id: objectId, accessToken: 'nope' }], completeness: 'full', classification: 'restricted-operational', freshness: 'current', redaction: 'none' }, tenantId, 'cases')).toThrow(BrowserContractError);
    expect(() => decodeProjection({ tenantId, collection: 'workflow-webhook-credentials', records: [{ id: objectId, secret: 'nope' }], completeness: 'full', classification: 'restricted-operational', freshness: 'current', redaction: 'applied' }, tenantId, 'workflow-webhook-credentials')).toThrow(BrowserContractError);
    expect(() => decodeReceipt({ commandId: objectId, objectId, owner: 'studio', name: 'submit', state: 'committed', version: -1, watermark: 2, affectedCollections: ['cases'], evidenceIds: [], digest: 'a'.repeat(64) })).toThrow(BrowserContractError);
  });
});

describe('governance command arguments', () => {
  const create = { name: 'Platform', tenantIds: [tenantId], billingTenantId: null };
  const ids = (count: number) => Array.from({ length: count }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);

  test('accepts a valid create-group with a null billing workspace', () => {
    expect(decodeCommandArguments('governance', 'create-group', create)).toEqual(create);
    expect(decodeCommandArguments('governance', 'create-group', { ...create, tenantIds: ids(50), billingTenantId: ids(50)[0] })).toMatchObject({ name: 'Platform' });
    expect(decodeCommandArguments('governance', 'add-tenant', { tenantId })).toEqual({ tenantId });
    expect(decodeCommandArguments('governance', 'remove-tenant', { tenantId })).toEqual({ tenantId });
  });

  test.each([
    ['no workspaces', { ...create, tenantIds: [] }],
    ['51 workspaces', { ...create, tenantIds: ids(51) }],
    ['a duplicate workspace', { ...create, tenantIds: [tenantId, tenantId] }],
    ['a non-UUID workspace', { ...create, tenantIds: ['nope'] }],
    ['an empty name', { ...create, name: '' }],
    ['a 129-char name', { ...create, name: 'x'.repeat(129) }],
    ['an omitted billing workspace', { name: 'Platform', tenantIds: [tenantId] }],
    ['a non-UUID billing workspace', { ...create, billingTenantId: 'nope' }],
  ])('rejects create-group with %s', (_name, value) => {
    expect(() => decodeCommandArguments('governance', 'create-group', value)).toThrow(BrowserContractError);
  });

  test('rejects a non-UUID workspace on add-tenant', () => {
    expect(() => decodeCommandArguments('governance', 'add-tenant', { tenantId: 'nope' })).toThrow(BrowserContractError);
  });

  test('accepts admin and billing commands with a valid id', () => {
    const userId = '22222222-2222-4222-8222-222222222222';
    expect(decodeCommandArguments('governance', 'add-admin', { userId })).toEqual({ userId });
    expect(decodeCommandArguments('governance', 'remove-admin', { userId })).toEqual({ userId });
    expect(decodeCommandArguments('governance', 'set-billing-tenant', { tenantId })).toEqual({ tenantId });
  });

  test.each([
    ['add-admin', { userId: 'nope' }],
    ['add-admin', {}],
    ['remove-admin', { userId: 'nope' }],
    ['add-admin', { userId: '22222222-2222-4222-8222-222222222222', tenantId }],
    ['set-billing-tenant', { tenantId: 'nope' }],
    ['set-billing-tenant', { tenantId: null }],
  ])('rejects %s arguments %j', (name, value) => {
    expect(() => decodeCommandArguments('governance', name, value)).toThrow(BrowserContractError);
  });
});

