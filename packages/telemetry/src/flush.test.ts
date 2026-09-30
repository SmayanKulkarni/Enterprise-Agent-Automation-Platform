import { afterEach, expect, test, vi } from 'vitest';
import { flushWithin } from './flush.js';

afterEach(() => vi.useRealTimers());

test('resolves at the cap when a target never settles', async () => {
  vi.useFakeTimers();
  let done = false;
  const flushed = flushWithin([() => new Promise(() => undefined)], 2000).then(() => { done = true; });

  await vi.advanceTimersByTimeAsync(1999);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await flushed;
  expect(done).toBe(true);
});

test('resolves when a target rejects or throws synchronously', async () => {
  await expect(flushWithin([() => Promise.reject(new Error('exporter down')), () => { throw new Error('sync failure'); }, () => Promise.resolve()], 2000)).resolves.toBeUndefined();
});

test('resolves at once and leaves no timer behind when every target settles', async () => {
  vi.useFakeTimers();
  await flushWithin([() => Promise.resolve(), () => Promise.resolve()], 2000);

  expect(vi.getTimerCount()).toBe(0);
});

test('resolves with no targets', async () => {
  await expect(flushWithin([], 2000)).resolves.toBeUndefined();
});
