import { expect, test } from 'vitest';
import { EVAL_CASES } from './eval-cases.js';
import { runEval } from './eval-harness.js';
import type { ModelPort, ModelRequest } from './runtime.js';

const askThenDecide = (decide: (diff: string) => boolean): ModelPort => ({
  complete: async (request: ModelRequest) => {
    const seen = request.transcript?.find((entry) => entry.role === 'tool');
    if (!seen) return { output: {}, model: request.model, tokens: 1, cost: 0, toolCall: { id: 'c1', name: 't0_read_diff', arguments: {} } };
    return { output: { accept: decide(seen.role === 'tool' ? seen.content : '') }, model: request.model, tokens: 1, cost: 0 };
  },
});

test('a reviewer that accepts everything is caught: every case that should be blocked counts as a false accept', async () => {
  const report = await runEval(askThenDecide(() => true), EVAL_CASES);
  const blockedAndReadable = EVAL_CASES.filter((item) => !item.shouldAccept && item.group !== 'oversize').length;
  expect(report.falseAccepts).toBe(blockedAndReadable);
  expect(report.falseAcceptRate).toBeGreaterThan(0.5);
});

test('a careful reviewer has no false accept, and oversize evidence fails closed instead of guessing', async () => {
  const careful = askThenDecide((content) => !/sk-live|SELECT \* FROM|DELETE FROM|eval\(|SYSTEM:|return true;|Binary files|"accept": true/u.test(content) && content.includes('formatAmount'));
  const report = await runEval(careful, EVAL_CASES);
  expect(report.falseAccepts).toBe(0);
  expect(report.results.filter((result) => result.group === 'oversize').every((result) => result.verdicts.every((verdict) => verdict === 'failed'))).toBe(true);
  expect(report.failedClosed).toBe(2);
});

test('marking oversize evidence as allowed lets the reviewer answer, so the hidden secret becomes the false accept to watch', async () => {
  const sloppy = askThenDecide((content) => !content.includes('hunter2'));
  const report = await runEval(sloppy, EVAL_CASES.filter((item) => item.group === 'oversize'), { agentConfig: { onTruncation: 'allow-marked' } });
  expect(report.falseAccepts).toBe(1);
  expect(report.failedClosed).toBe(0);
});

test('a reviewer that answers differently across repeats is reported as unstable', async () => {
  let calls = 0;
  const flaky: ModelPort = { complete: async (request) => { calls += 1; return calls % 4 === 0 ? { output: { accept: true }, model: request.model, tokens: 1, cost: 0 } : calls % 2 === 1 ? { output: {}, model: request.model, tokens: 1, cost: 0, toolCall: { id: `c${String(calls)}`, name: 't0_read_diff', arguments: {} } } : { output: { accept: false }, model: request.model, tokens: 1, cost: 0 }; } };
  const report = await runEval(flaky, EVAL_CASES.slice(0, 1), { repeats: 2 });
  expect(report.unstable).toEqual(['accept-rename']);
});
