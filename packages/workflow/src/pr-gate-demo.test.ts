import { expect, test } from 'vitest';
import { DEMO_DEFINITION_ID, SAMPLE_DIFF, SAMPLE_PULL_REQUEST, demoGraph, parseVerdict, reviewDiff, runDemo } from './pr-gate-demo.js';

const CLEAN_DIFF = ['diff --git a/src/sum.ts b/src/sum.ts', '--- a/src/sum.ts', '+++ b/src/sum.ts', '@@ -1,3 +1,4 @@', ' export const sum = (a: number, b: number) => a + b;', '+export const product = (a: number, b: number) => a * b;', ''].join('\n');
const input = (diff: string) => ({ id: 'e0000000-0000-4000-8000-000000000001', now: Date.parse('2026-10-07T10:00:00.000Z'), pullRequest: SAMPLE_PULL_REQUEST, diff, source: 'sample' as const });

test('the demo graph is the PR gate with a placeholder connector pair and no credentials', () => {
  const graph = demoGraph();
  expect(graph.nodes.map((node) => node.id).sort()).toEqual(['approve_issue', 'approve_merge', 'end_merged', 'end_returned', 'gate_accept', 'intake', 'issue', 'merge', 'reviewer', 'status', 't_diff']);
  expect(JSON.stringify(graph)).not.toMatch(/bearer |gh[pousr]_|github_pat_|sk-or-|BEGIN [A-Z ]*PRIVATE KEY/iu);
  expect(DEMO_DEFINITION_ID).toMatch(/^[0-9a-f-]{36}$/u);
});

test('the sample diff is blocked with a secret and an injection finding that name file and line', () => {
  const verdict = reviewDiff(SAMPLE_DIFF);
  expect(verdict.accept).toBe(false);
  expect(verdict.riskLevel).toBe('high');
  expect(verdict.findings.map((finding) => finding.problem).join(' ')).toMatch(/secret/iu);
  expect(verdict.findings.map((finding) => finding.problem).join(' ')).toMatch(/injection/iu);
  expect(verdict.findings.every((finding) => finding.file.length > 0 && finding.line > 0)).toBe(true);
});

test('a clean diff is accepted at low risk', () => {
  expect(reviewDiff(CLEAN_DIFF)).toMatchObject({ accept: true, riskLevel: 'low', findings: [] });
});

test('removing tests without adding any is a medium finding', () => {
  const diff = ['--- a/a.test.ts', '+++ b/a.test.ts', '@@ -1,3 +1,1 @@', "-test('adds', () => {});", "-test('subtracts', () => {});", ' export {};'].join('\n');
  expect(reviewDiff(diff)).toMatchObject({ accept: false, riskLevel: 'medium' });
});

test('a blocked review walks to the return approval and waits there', () => {
  const run = runDemo(input(SAMPLE_DIFF));
  expect(run.steps.map((step) => step.nodeId)).toEqual(['intake', 'reviewer', 't_diff', 'gate_accept', 'approve_issue']);
  expect(run.steps.at(-1)).toMatchObject({ state: 'waiting' });
  expect(run).toMatchObject({ outcome: 'awaiting-approval', waitingNodeId: 'approve_issue', branch: 'return', source: 'sample' });
});

test('an accepted review walks to the merge approval', () => {
  const run = runDemo(input(CLEAN_DIFF));
  expect(run.steps.at(-1)).toMatchObject({ nodeId: 'approve_merge', state: 'waiting' });
  expect(run.branch).toBe('accept');
});

test('step times are cumulative and the run is deterministic', () => {
  const first = runDemo(input(SAMPLE_DIFF));
  expect(runDemo(input(SAMPLE_DIFF))).toEqual(first);
  first.steps.reduce((expected, step) => { expect(step.startMs).toBe(expected); return step.startMs + step.durationMs; }, 0);
});

test('a model verdict is validated, clamped and used by the run', () => {
  const verdict = parseVerdict({ accept: false, riskLevel: 'high', summary: 'x'.repeat(2000), findings: [{ file: 'a.ts', line: 3, problem: 'p', fix: 'f' }] });
  expect(verdict).toMatchObject({ accept: false, riskLevel: 'high', findings: [{ file: 'a.ts', line: 3, problem: 'p', fix: 'f' }] });
  expect(verdict?.summary.length).toBeLessThanOrEqual(500);
  const run = runDemo({ ...input(CLEAN_DIFF), verdict });
  expect(run.verdict).toEqual(verdict);
  expect(run.branch).toBe('return');
});
test.each([
  null,
  'accept',
  { accept: 'yes', riskLevel: 'low', summary: 's', findings: [] },
  { accept: true, riskLevel: 'critical', summary: 's', findings: [] },
  { accept: true, riskLevel: 'low', summary: '', findings: [] },
  { accept: true, riskLevel: 'low', summary: 's', findings: [{ file: 'a.ts', line: 1.5, problem: 'p', fix: 'f' }] },
  { accept: true, riskLevel: 'low', summary: 's', findings: Array.from({ length: 11 }, () => ({ file: 'a.ts', line: 1, problem: 'p', fix: 'f' })) },
])('an invalid model verdict is rejected: %j', (value) => {
  expect(parseVerdict(value)).toBeUndefined();
});
