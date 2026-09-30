import { describe, expect, test } from 'vitest';

import { seedSource } from '../../tools/sql/admin-seed.mjs';

const TENANT = '11111111-1111-4111-8111-111111111111';
const SOURCE = "N'$(ADMIN_ISSUER)' N'$(ADMIN_SUBJECT)' N'$(ADMIN_TENANTS)'";
const env = { CLERK_ISSUER: 'https://clerk.example.com', ADMIN_TEST_CLERK_SUBJECT: 'user_2abc', PLATFORM_LOCAL_TENANTS: TENANT };

describe('admin seed substitution', () => {
  test('leaves other seed files untouched', () => {
    expect(seedSource('001_identity_demo.sql', 'SELECT 1', {})).toBe('SELECT 1');
  });

  test('substitutes placeholders in the tenant group demo seed', () => {
    expect(seedSource('005_tenant_group_demo.sql', SOURCE, env)).toBe("N'https://clerk.example.com' N'user_2abc' N'11111111-1111-4111-8111-111111111111'");
    expect(seedSource('005_tenant_group_demo.sql', SOURCE, { ...env, ADMIN_TEST_CLERK_SUBJECT: '' })).toBeUndefined();
  });

  test('skips the admin seed when no subject is configured', () => {
    expect(seedSource('004_admin_test_account.sql', SOURCE, { ...env, ADMIN_TEST_CLERK_SUBJECT: '  ' })).toBeUndefined();
  });

  test('substitutes issuer, subject and tenants', () => {
    expect(seedSource('004_admin_test_account.sql', SOURCE, { ...env, PLATFORM_LOCAL_TENANTS: `${TENANT}, 22222222-2222-4222-8222-222222222222` }))
      .toBe("N'https://clerk.example.com' N'user_2abc' N'11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222'");
  });

  test('doubles single quotes in the issuer', () => {
    expect(seedSource('004_admin_test_account.sql', "N'$(ADMIN_ISSUER)'", { ...env, CLERK_ISSUER: "https://a.example.com/x'y" })).toBe("N'https://a.example.com/x''y'");
  });

  test.each([
    ['subject with a quote', { ADMIN_TEST_CLERK_SUBJECT: "x'; DROP TABLE t; --" }, /unsupported characters/u],
    ['missing issuer', { CLERK_ISSUER: '' }, /Missing CLERK_ISSUER/u],
    ['non-URL issuer', { CLERK_ISSUER: 'not a url' }, /valid issuer/u],
    ['ftp issuer', { CLERK_ISSUER: 'ftp://example.com' }, /valid issuer/u],
    ['missing tenants', { PLATFORM_LOCAL_TENANTS: '' }, /Missing PLATFORM_LOCAL_TENANTS/u],
    ['comma-only tenants', { PLATFORM_LOCAL_TENANTS: ' , ' }, /lists no tenants/u],
    ['non-GUID tenant', { PLATFORM_LOCAL_TENANTS: `${TENANT},x'--` }, /tenant GUIDs/u],
  ])('rejects %s', (_name, override, message) => {
    expect(() => seedSource('004_admin_test_account.sql', SOURCE, { ...env, ...override })).toThrow(message);
  });
});
