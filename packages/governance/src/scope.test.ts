import { expect, test } from 'vitest';
import { tenantMatcher, tenantPattern } from './scope.js';

const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';

test('builds the exact matcher for two ids', () => {
  expect(tenantMatcher([a, b])).toBe(`tenant_id=~"${a}|${b}"`);
});

test('lowercases ids in the pattern', () => {
  expect(tenantPattern([a.toUpperCase().replace(/-/gu, '-')])).toBe(a);
});

test.each([
  ['an empty list', []],
  ['a non-uuid', ['abc']],
  ['a uuid with a trailing quote', [`${a}"`]],
  ['a matcher breakout', ['x"} or {y="']],
  ['one bad id among good ones', [a, 'nope']],
])('throws INVALID for %s', (_name, ids) => {
  expect(() => tenantMatcher(ids)).toThrow(expect.objectContaining({ code: 'INVALID' }));
});
