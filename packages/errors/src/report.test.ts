import { afterEach, expect, test, vi } from 'vitest';
import { classify } from './classify.js';
import { report } from './report.js';
import { reported } from './swallow.js';

afterEach(() => vi.restoreAllMocks());

const lines = (spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] => spy.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);

test('logs 4xx at warn without a stack', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  report(new Error('DENIED'), { correlationId: 'c1', tenantId: 't1', method: 'GET', route: '/api/v1/session' });
  expect(lines(warn)).toEqual([expect.objectContaining({ correlationId: 'c1', tenantId: 't1', method: 'GET', route: '/api/v1/session', status: 403, code: 'DENIED', category: 'denied' })]);
  expect(lines(warn)[0]).not.toHaveProperty('stack');
});

test('logs 5xx at error with a stack and redacts bearer tokens', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  report(new Error('upstream said Bearer abc.def.ghi rejected'), { correlationId: 'c2' });
  const [line] = lines(error);
  expect(line).toMatchObject({ status: 500, code: 'INTERNAL' });
  expect(line).toHaveProperty('stack');
  expect(JSON.stringify(line)).not.toContain('abc.def.ghi');
});

test('logs an error once even when reported twice', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const app = classify(new Error('STALE'));
  report(app, { correlationId: 'c3' });
  report(app, { correlationId: 'c3' });
  expect(warn).toHaveBeenCalledTimes(1);
});

test('reported returns the fallback and reports once with the site', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(reported([] as string[], 'runtime.proposals')(new Error('boom'))).toEqual([]);
  expect(lines(error)).toEqual([expect.objectContaining({ site: 'runtime.proposals' })]);
});

test('keeps a multi-frame stack and redacts key=value secrets', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const cause = new Error('connect failed password=hunter2 api-key: abc123');
  cause.stack = `Error: ${cause.message}\n${'    at frame (file.ts:1:1)\n'.repeat(30)}`;
  report(cause, { correlationId: 'c4' });
  const [line] = lines(error);
  expect(String(line?.['stack']).split('\n').length).toBeGreaterThan(20);
  expect(JSON.stringify(line)).not.toMatch(/hunter2|abc123/u);
});
