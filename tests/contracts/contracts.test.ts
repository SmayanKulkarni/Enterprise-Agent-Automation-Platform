import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  assertCompatible,
  canonicalJson,
  ContractValidationError,
  decodeContract,
  descriptorFor,
  digest,
  encodeContract,
} from '../../packages/contracts/src/index.js';

const fixtures = resolve('docs/contracts/v1/fixtures');
const tenant = '22222222-2222-4222-8222-222222222222';
const fixture = (name: string): Record<string, unknown> => JSON.parse(readFileSync(resolve(fixtures, name), 'utf8')) as Record<string, unknown>;

describe('@platform/contracts', () => {
  test('validates every portable fixture through the packed codec shape', async () => {
    for (const name of readdirSync(fixtures).filter((name) => name !== 'version-mismatch.json')) {
      const value = fixture(name);
      const descriptor = descriptorFor(value['contract'] as string);
      const encoded = await encodeContract(descriptor, value as never);
      expect(decodeContract(descriptor, encoded.bytes, tenant).messageId).toBe(value['messageId']);
      expect(encoded.digest).toBe(await digest(value));
    }
    const mismatch = fixture('version-mismatch.json');
    expect(() => decodeContract(descriptorFor(mismatch['contract'] as string), JSON.stringify(mismatch), tenant)).toThrow(
      expect.objectContaining({ code: 'INCOMPATIBLE_VERSION' }),
    );
  });

  test('fails closed for duplicate JSON, wrong tenant, unsafe data, and incompatible versions', () => {
    const value = fixture('success.json');
    const descriptor = descriptorFor('case.command');
    const duplicated = JSON.stringify(value).replace('"messageId":', '"messageId":"11111111-1111-4111-8111-111111111110","messageId":');
    expect(() => decodeContract(descriptor, duplicated, tenant)).toThrow(expect.objectContaining({ code: 'DUPLICATE_KEY' }));
    expect(() => decodeContract(descriptor, JSON.stringify(value), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toThrow(expect.objectContaining({ code: 'TENANT_MISMATCH' }));
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(ContractValidationError);
    expect(assertCompatible('1.2.3', '>=2.0.0 <3.0.0')).toEqual({ compatible: false, reason: 'incompatible-major' });
  });
});
