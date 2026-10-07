import { expect, test, vi } from 'vitest';
import { SAMPLE_DIFF, SAMPLE_PULL_REQUEST, runDemo } from '../../../../packages/workflow/src/pr-gate-demo.js';
import { DemoApiError, requestDemoRun } from './demo-api.js';
import { emptyDemo, enterDemo, isDemoRun, leaveDemo, loadDemo, saveDemo, withRun, type DemoStorage } from './demo-state.js';

const run = runDemo({ id: 'e0000000-0000-4000-8000-000000000001', now: Date.parse('2026-10-07T10:00:00.000Z'), pullRequest: SAMPLE_PULL_REQUEST, diff: SAMPLE_DIFF, source: 'sample' });
const memory = (initial?: string): DemoStorage & { value: string | undefined } => {
  const box = { value: initial, getItem: () => box.value ?? null, setItem: (_key: string, value: string) => { box.value = value; } };
  return box;
};

test('a server run passes the shape check and a damaged one does not', () => {
  expect(isDemoRun(run)).toBe(true);
  expect(isDemoRun({ ...run, steps: [{ nodeId: 1 }] })).toBe(false);
  expect(isDemoRun({ ...run, outcome: 'completed' })).toBe(false);
  expect(isDemoRun(null)).toBe(false);
});

test('the demo state survives a reload with its run', () => {
  const storage = memory();
  saveDemo(withRun(enterDemo(emptyDemo), run), storage);
  expect(loadDemo(storage)).toEqual({ active: true, run });
});

test('leaving the demo keeps the run so the one allowed run is not lost', () => {
  const storage = memory();
  saveDemo(leaveDemo(withRun(emptyDemo, run)), storage);
  expect(loadDemo(storage)).toEqual({ active: false, run });
});

test('missing, broken or unavailable storage falls back to an empty demo', () => {
  expect(loadDemo(memory())).toEqual(emptyDemo);
  expect(loadDemo(memory('{broken'))).toEqual(emptyDemo);
  expect(loadDemo(memory(JSON.stringify({ active: true, run: { id: 'x' } })))).toEqual({ active: true, run: undefined });
  expect(loadDemo(undefined)).toEqual(emptyDemo);
  expect(() => { saveDemo(emptyDemo, { getItem: () => null, setItem: (): void => { throw new Error('quota'); } }); }).not.toThrow();
});

const reply = (status: number, body: unknown) => vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

test('the demo request posts only what the visitor typed and returns the run', async () => {
  const fetcher = reply(200, { run });
  vi.stubGlobal('fetch', fetcher);
  expect(await requestDemoRun({ githubToken: 'a'.repeat(30), pullRequest: 'https://github.com/o/r/pull/1' }, undefined, 'https://api.example.com')).toEqual(run);
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://api.example.com/api/v1/demo/run');
  expect(init).toMatchObject({ method: 'POST', credentials: 'omit' });
  vi.unstubAllGlobals();
});

test('server refusals keep their code and the used-address message', async () => {
  vi.stubGlobal('fetch', reply(429, { error: { code: 'DEMO_RUN_USED', message: 'This address has already used its one demo run.' } }));
  await expect(requestDemoRun({})).rejects.toMatchObject({ status: 429, code: 'DEMO_RUN_USED', message: 'This address has already used its one demo run.' });
  vi.stubGlobal('fetch', reply(502, { nope: true }));
  await expect(requestDemoRun({})).rejects.toBeInstanceOf(DemoApiError);
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('network'))));
  await expect(requestDemoRun({})).rejects.toMatchObject({ code: 'DEMO_UNAVAILABLE', status: 0 });
  vi.unstubAllGlobals();
});
