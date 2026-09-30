import { describe, expect, test } from 'vitest';

import {
  assertCompatible,
  canonicalJson,
  ContractValidationError,
  CONTRACT_DESCRIPTORS,
  decodeContract,
  descriptorFor,
  digest,
  encodeContract,
} from '../../packages/contracts/src/index.js';

const tenant = '22222222-2222-4222-8222-222222222222';
const fixture = (contract: string, contractVersion = '1.0.0') => ({
  messageId: '11111111-1111-4111-8111-111111111111' as const,
  contract,
  contractVersion,
  occurredAt: '2099-01-01T00:00:00.000Z',
  sender: 'contract-test',
  tenantId: tenant,
  classification: descriptorFor(contract).classification,
  payload: { outcome: 'success' },
});

describe('@platform/contracts', () => {
  test('validates every declared contract through the packed codec shape', async () => {
    for (const name of Object.keys(CONTRACT_DESCRIPTORS)) {
      const value = fixture(name);
      const descriptor = descriptorFor(name);
      const encoded = await encodeContract(descriptor, value as never);
      expect(decodeContract(descriptor, encoded.bytes, tenant).messageId).toBe(value['messageId']);
      expect(encoded.digest).toBe(await digest(value));
    }
    const mismatch = fixture('case.command', '2.0.0');
    expect(() => decodeContract(descriptorFor(mismatch.contract), JSON.stringify(mismatch), tenant)).toThrow(
      expect.objectContaining({ code: 'INCOMPATIBLE_VERSION' }),
    );
  });

  test('fails closed for duplicate JSON, wrong tenant, unsafe data, and incompatible versions', () => {
    const value = fixture('case.command');
    const descriptor = descriptorFor('case.command');
    const duplicated = JSON.stringify(value).replace('"messageId":', '"messageId":"11111111-1111-4111-8111-111111111110","messageId":');
    expect(() => decodeContract(descriptor, duplicated, tenant)).toThrow(expect.objectContaining({ code: 'DUPLICATE_KEY' }));
    expect(() => decodeContract(descriptor, JSON.stringify(value), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toThrow(expect.objectContaining({ code: 'TENANT_MISMATCH' }));
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(ContractValidationError);
    expect(assertCompatible('1.2.3', '>=2.0.0 <3.0.0')).toEqual({ compatible: false, reason: 'incompatible-major' });
  });

  test('requires a tenant id on browser.v1 but not on governance.v1', () => {
    const unscoped: Record<string, unknown> = { ...fixture('governance.v1') };
    delete unscoped['tenantId'];
    const scoped = { ...unscoped, contract: 'browser.v1', classification: descriptorFor('browser.v1').classification };
    expect(decodeContract(descriptorFor('governance.v1'), JSON.stringify(unscoped)).contract).toBe('governance.v1');
    expect(() => decodeContract(descriptorFor('browser.v1'), JSON.stringify(scoped))).toThrow(expect.objectContaining({ code: 'MISSING_TENANT' }));
    expect(Object.values(CONTRACT_DESCRIPTORS).filter((descriptor) => !descriptor.tenantScoped).map((descriptor) => descriptor.name)).toEqual(['governance.v1']);
  });
});
