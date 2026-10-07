import { expect, test } from 'vitest';
import { demoLimiter } from './demo-limit.js';

const limits = { perKey: 3, global: 5, windowMs: 1000 };

test('a key is limited inside the window and recovers in the next one', () => {
  let now = 0;
  const allow = demoLimiter(limits, () => now);
  expect([1, 2, 3, 4].map(() => allow('a'))).toEqual([true, true, true, false]);
  expect(allow('b')).toBe(true);
  now = 1000;
  expect(allow('a')).toBe(true);
});

test('the global ceiling applies across keys', () => {
  const allow = demoLimiter(limits, () => 0);
  expect(['a', 'b', 'c', 'd', 'e', 'f'].map((key) => allow(key))).toEqual([true, true, true, true, true, false]);
});

test('a refused call does not use up the global ceiling', () => {
  const allow = demoLimiter({ perKey: 1, global: 2, windowMs: 1000 }, () => 0);
  expect([allow('a'), allow('a'), allow('a'), allow('b')]).toEqual([true, false, false, true]);
});

test('old keys are forgotten so memory stays bounded', () => {
  let now = 0;
  const allow = demoLimiter({ perKey: 1, global: 100_000, windowMs: 1000 }, () => now);
  for (let index = 0; index < 1000; index += 1) allow(`k${String(index)}`);
  now = 5000;
  expect(allow('k1')).toBe(true);
});
