import { expect, test } from 'vitest';
import { activeFacts, bytesPerItem, duplication, memoryReport, precisionAtK, salience } from './memory-metrics.mjs';

/** @param {string} id @param {string} text @param {string[]} subjects */
const row = (id, text, subjects, type = 'task-fact', state = 'promoted') => ({ id, text, subjects, type, state });

test('salience counts items whose text names one of their subjects by key or local part', () => {
  const items = [row('a', 'npm:zod: low risk.', ['npm:zod']), row('b', 'zod has 1 advisory', ['npm:zod']), row('c', 'Workflow completed successfully.', ['npm:zod']), row('d', 'no subjects at all', [])];
  expect(salience(items)).toBe(0.5);
  expect(salience([])).toBe(0);
});

test('duplication counts only active items per subject', () => {
  const items = [row('a', 't', ['npm:zod']), row('b', 't', ['npm:zod']), row('c', 't', ['npm:zod'], 'task-fact', 'withdrawn'), row('d', 't', ['npm:lodash']), row('e', 't', [])];
  expect(duplication(items)).toEqual({ 'npm:zod': 2, 'npm:lodash': 1, '(none)': 1 });
  expect(activeFacts([...items, row('f', 's', ['npm:zod'], 'run-summary')])).toEqual({ 'npm:zod': 2, 'npm:lodash': 1, '(none)': 1 });
});

test('precision at k is the share of the returned top-k that match the subject', () => {
  const returned = [{ subjects: ['npm:zod'] }, { subjects: ['npm:zod'] }, { subjects: ['npm:lodash'] }, { subjects: [] }, { subjects: ['npm:zod'] }, { subjects: ['npm:zod'] }];
  expect(precisionAtK(returned, 'npm:zod', 5)).toBe(0.6);
  expect(precisionAtK(returned, 'npm:zod', 2)).toBe(1);
  expect(precisionAtK([], 'npm:zod', 5)).toBe(0);
});

test('bytes per item measure UTF-8 text size', () => {
  expect(bytesPerItem([row('a', 'abcd', []), row('b', 'é', [])])).toEqual({ count: 2, meanTextBytes: 3, maxTextBytes: 4 });
  expect(bytesPerItem([])).toEqual({ count: 0, meanTextBytes: 0, maxTextBytes: 0 });
});

test('the report bundles every metric', () => {
  const items = [row('a', 'npm:zod: ok.', ['npm:zod'])];
  expect(memoryReport(items, [{ subject: 'npm:zod', k: 5, returned: [{ subjects: ['npm:zod'] }] }])).toEqual({ salience: 1, duplication: { 'npm:zod': 1 }, activeFacts: { 'npm:zod': 1 }, bytes: { count: 1, meanTextBytes: 12, maxTextBytes: 12 }, precision: [{ subject: 'npm:zod', k: 5, value: 1 }] });
});
