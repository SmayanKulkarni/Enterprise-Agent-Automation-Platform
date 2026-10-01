import { describe, expect, test } from 'vitest';
import { nextPoll, POLL_MS } from './use-pending-approvals.js';

describe('nextPoll', () => {
  const now = 1_000_000;
  test('stops while the page is hidden', () => {
    expect(nextPoll('hidden', undefined, now)).toBe('stop');
    expect(nextPoll('hidden', now - 10 * POLL_MS, now)).toBe('stop');
  });
  test('loads when visible and never loaded or stale', () => {
    expect(nextPoll('visible', undefined, now)).toBe('now');
    expect(nextPoll('visible', now - 31_000, now)).toBe('now');
  });
  test('waits when visible and loaded recently', () => {
    expect(nextPoll('visible', now - 5_000, now)).toBe('wait');
  });
});
