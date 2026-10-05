import { expect, test } from 'vitest';
import { errorCounts, improvements, regressions } from './lint-ratchet.mjs';
import { scan } from './secret-scan.mjs';

test('only errors are counted and files without errors are left out', () => {
  const counts = errorCounts([
    { filePath: `${process.cwd()}/a.ts`, messages: [{ severity: 2 }, { severity: 1 }, { severity: 2 }] },
    { filePath: `${process.cwd()}/b.ts`, messages: [{ severity: 1 }] },
  ]);
  expect(Object.values(counts)).toEqual([2]);
});

test('a file may keep or reduce its errors but not add any, and a new file starts at zero', () => {
  expect(regressions({ 'a.ts': 3, 'b.ts': 1 }, { 'a.ts': 3 })).toEqual([{ file: 'b.ts', count: 1, allowed: 0 }]);
  expect(regressions({ 'a.ts': 2 }, { 'a.ts': 3 })).toEqual([]);
  expect(regressions({ 'a.ts': 4 }, { 'a.ts': 3 })).toEqual([{ file: 'a.ts', count: 4, allowed: 3 }]);
  expect(improvements({ 'a.ts': 1 }, { 'a.ts': 3, 'gone.ts': 2 })).toEqual([{ file: 'a.ts', count: 1, allowed: 3 }, { file: 'gone.ts', count: 0, allowed: 2 }]);
});

test.each([
  ['a private key', `${'-----BEGIN '}${'RSA PRIVATE KEY-----'}\nabc`],
  ['a Stripe live key', `const k = "${'sk_live_'}${'a1B2c3D4e5F6g7H8'}";`],
  ['a GitHub token', `token=${'ghp_'}${'a'.repeat(36)}`],
  ['an AWS key id', `id=${'AKIA'}${'ABCDEFGHIJKLMNOP'}`],
  ['an OpenRouter key', `${'sk-or-v1-'}${'0'.repeat(40)}`],
])('the secret scan flags %s', (_label, text) => {
  expect(scan(text)).not.toEqual([]);
});

test.each([['a bare prefix', 'the sk_live_ prefix'], ['a short placeholder', 'sk_live_xxxx'], ['ordinary code', 'const apiKey = process.env.API_KEY;']])('the secret scan leaves %s alone', (_label, text) => {
  expect(scan(text)).toEqual([]);
});
