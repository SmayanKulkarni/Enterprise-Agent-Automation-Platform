import { expect, test } from 'vitest';
import { validateGraph, type GraphDraft } from './graph.js';
import { APPROVAL_MAX_TIMEOUT_MS, MAX_TIMER_MS, nextTimerAt } from './timers.js';

const DAY = 86400000;

test('a wait longer than one timer is split so no single timer exceeds the platform limit', () => {
  const start = 0; const deadline = 7 * DAY; const stops: number[] = [];
  for (let now = start; now < deadline; now = nextTimerAt(now, deadline)) stops.push(nextTimerAt(now, deadline));
  expect(stops).toEqual([5 * DAY, 7 * DAY]);
  expect(MAX_TIMER_MS).toBeLessThan(6 * DAY);
});

test('a short wait uses one timer that ends exactly at the deadline', () => {
  expect(nextTimerAt(1000, 5000)).toBe(5000);
});

const draft = (timeoutMs: number): GraphDraft => ({ kind: 'graph-v1', nodes: [{ id: 'gate', kind: 'approval', title: 'gate', detail: '', x: 0, y: 0, instructions: '', config: { timeoutMs } }], edges: [] });

test.each([[7 * DAY, true], [APPROVAL_MAX_TIMEOUT_MS, true], [APPROVAL_MAX_TIMEOUT_MS + 1, false]])('approval timeout %i is accepted: %s', (timeoutMs, accepted) => {
  const invalid = validateGraph(draft(timeoutMs)).some((issue) => issue.code === 'INVALID_APPROVAL');
  expect(invalid).toBe(!accepted);
});
