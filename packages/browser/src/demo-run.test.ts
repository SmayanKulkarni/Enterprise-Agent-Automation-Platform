import { expect, test } from 'vitest';
import { claimKey, clientIp, handleDemoRun, type DemoRunDeps } from './demo-run.js';

const TOKEN = 'github_pat_' + 'x'.repeat(40);
const PR_URL = 'https://github.com/octo/widgets/pull/7';
const DIFF = ['--- a/a.ts', '+++ b/a.ts', '@@ -1,1 +1,2 @@', ' export {};', '+export const ok = 1;', ''].join('\n');
const PULL = { title: 'Add ok', user: { login: 'octocat' }, head: { sha: 'abc1234abc1234abc1234abc1234abc1234abc1' } };

interface Calls { urls: string[]; headers: Record<string, string>[] }
const harness = (overrides: Partial<DemoRunDeps> = {}, github: (url: string, accept: string) => Response = (_url, accept) => accept.includes('diff') ? new Response(DIFF) : Response.json(PULL)) => {
  const claims = new Set<string>();
  const calls: Calls = { urls: [], headers: [] };
  const deps: DemoRunDeps = {
    claimed: (key) => Promise.resolve(claims.has(key)),
    claim: (key) => { if (claims.has(key)) return Promise.resolve(false); claims.add(key); return Promise.resolve(true); },
    fetch: (url, init) => { const headers = Object.fromEntries(new Headers(init?.headers).entries()); calls.urls.push(url); calls.headers.push(headers); return Promise.resolve(github(url, headers['accept'] ?? '')); },
    now: () => Date.parse('2026-10-07T10:00:00.000Z'),
    id: () => 'e0000000-0000-4000-8000-000000000001',
    pepper: 'test-pepper',
    ...overrides,
  };
  return { deps, claims, calls };
};
const post = (ip: string | undefined, body: unknown = {}) => ({ ip, body: JSON.stringify(body) });

test('a first request from an address returns the sample run and consumes the address', async () => {
  const { deps, claims } = harness();
  const reply = await handleDemoRun(post('203.0.113.9'), deps);
  expect(reply.status).toBe(200);
  expect(reply.body).toMatchObject({ run: { source: 'sample', outcome: 'awaiting-approval', branch: 'return' } });
  expect(claims.size).toBe(1);
});

test('the second request from the same address is refused without doing any work', async () => {
  const { deps, calls } = harness();
  await handleDemoRun(post('203.0.113.9'), deps);
  const reply = await handleDemoRun(post('203.0.113.9', { githubToken: TOKEN, pullRequest: PR_URL }), deps);
  expect(reply).toMatchObject({ status: 429, body: { error: { code: 'DEMO_RUN_USED' } } });
  expect(calls.urls).toEqual([]);
});

test('another address still gets its own run', async () => {
  const { deps } = harness();
  await handleDemoRun(post('203.0.113.9'), deps);
  expect((await handleDemoRun(post('203.0.113.10'), deps)).status).toBe(200);
});

test('a missing address fails closed and stores nothing', async () => {
  const { deps, claims } = harness();
  expect(await handleDemoRun(post(undefined), deps)).toMatchObject({ status: 503, body: { error: { code: 'DEMO_UNAVAILABLE' } } });
  expect(claims.size).toBe(0);
});

test('the stored key is a keyed hash, never the address', () => {
  const key = claimKey('203.0.113.9', 'test-pepper');
  expect(key).toMatch(/^[0-9a-f]{32}$/u);
  expect(key).not.toContain('203');
  expect(claimKey('203.0.113.9', 'other-pepper')).not.toBe(key);
});

test('a visitor token reads the pull request from api.github.com and is never echoed', async () => {
  const { deps, calls } = harness();
  const reply = await handleDemoRun(post('198.51.100.1', { githubToken: TOKEN, pullRequest: PR_URL }), deps);
  expect(reply.status).toBe(200);
  expect(calls.urls).toEqual(['https://api.github.com/repos/octo/widgets/pulls/7', 'https://api.github.com/repos/octo/widgets/pulls/7']);
  expect(calls.headers[0]).toMatchObject({ authorization: `Bearer ${TOKEN}` });
  expect(reply.body).toMatchObject({ run: { source: 'github', pullRequest: { owner: 'octo', repo: 'widgets', pullNumber: 7, author: 'octocat' }, branch: 'accept' } });
  expect(JSON.stringify(reply.body)).not.toContain(TOKEN);
});

test('a pull request without a token, or a token without a pull request, is invalid', async () => {
  const { deps, claims } = harness();
  expect((await handleDemoRun(post('198.51.100.1', { pullRequest: PR_URL }), deps)).status).toBe(400);
  expect((await handleDemoRun(post('198.51.100.1', { githubToken: TOKEN }), deps)).status).toBe(400);
  expect(claims.size).toBe(0);
});

test.each([
  ['https://evil.example/octo/widgets/pull/7'],
  ['https://github.com/octo/widgets/issues/7'],
  ['https://github.com/octo/wid gets/pull/7'],
  ['https://github.com/../etc/pull/7'],
  ['http://github.com/octo/widgets/pull/7'],
])('the pull request address %s is refused before any request is made', async (pullRequest) => {
  const { deps, calls } = harness();
  expect((await handleDemoRun(post('198.51.100.1', { githubToken: TOKEN, pullRequest }), deps)).status).toBe(400);
  expect(calls.urls).toEqual([]);
});

test('malformed or oversized bodies are invalid', async () => {
  const { deps } = harness();
  expect((await handleDemoRun({ ip: '198.51.100.1', body: '{not json' }, deps)).status).toBe(400);
  expect((await handleDemoRun({ ip: '198.51.100.1', body: JSON.stringify({ githubToken: 'a'.repeat(5000), pullRequest: PR_URL }) }, deps)).status).toBe(400);
  expect((await handleDemoRun({ ip: '198.51.100.1', body: '[]' }, deps)).status).toBe(400);
});

test('a rejected token does not consume the one run', async () => {
  const { deps, claims } = harness({}, () => new Response('{}', { status: 401 }));
  const reply = await handleDemoRun(post('198.51.100.1', { githubToken: TOKEN, pullRequest: PR_URL }), deps);
  expect(reply).toMatchObject({ status: 422, body: { error: { code: 'GITHUB_REJECTED' } } });
  expect(claims.size).toBe(0);
  expect(JSON.stringify(reply.body)).not.toContain(TOKEN);
});

test('a GitHub outage or network failure is reported as unavailable and keeps the run', async () => {
  const outage = harness({}, () => new Response('{}', { status: 503 }));
  expect(await handleDemoRun(post('198.51.100.1', { githubToken: TOKEN, pullRequest: PR_URL }), outage.deps)).toMatchObject({ status: 502, body: { error: { code: 'GITHUB_UNAVAILABLE' } } });
  const broken = harness({ fetch: () => Promise.reject(new Error('socket hang up')) });
  expect((await handleDemoRun(post('198.51.100.1', { githubToken: TOKEN, pullRequest: PR_URL }), broken.deps)).status).toBe(502);
  expect(outage.claims.size + broken.claims.size).toBe(0);
});

test('a lost race for the claim is reported as used', async () => {
  const { deps } = harness({ claim: () => Promise.resolve(false) });
  expect(await handleDemoRun(post('198.51.100.1'), deps)).toMatchObject({ status: 429, body: { error: { code: 'DEMO_RUN_USED' } } });
});

test('an unavailable claim store fails closed', async () => {
  const { deps } = harness({ claimed: () => Promise.reject(new Error('storage down')) });
  expect(await handleDemoRun(post('198.51.100.1'), deps)).toMatchObject({ status: 503, body: { error: { code: 'DEMO_UNAVAILABLE' } } });
});

test('the client address is the last forwarded entry, without a port', () => {
  expect(clientIp('6.6.6.6, 203.0.113.9')).toBe('203.0.113.9');
  expect(clientIp('203.0.113.9:51234')).toBe('203.0.113.9');
  expect(clientIp('[2001:db8::1]:443')).toBe('2001:db8::1');
  expect(clientIp('2001:db8::1')).toBe('2001:db8::1');
  expect(clientIp(null)).toBeUndefined();
  expect(clientIp('')).toBeUndefined();
  expect(clientIp('not an address')).toBeUndefined();
});

const MODEL_VERDICT = { accept: false, riskLevel: 'high', summary: 'Model found a problem.', findings: [{ file: 'a.ts', line: 2, problem: 'Bad.', fix: 'Fix it.' }] };

test('the model verdict replaces the deterministic one and sees the diff once', async () => {
  const diffs: string[] = [];
  const { deps } = harness({ review: (diff) => { diffs.push(diff); return Promise.resolve(MODEL_VERDICT); } });
  const reply = await handleDemoRun(post('203.0.113.9', { githubToken: TOKEN, pullRequest: PR_URL }), deps);
  expect(reply.body).toMatchObject({ run: { verdict: MODEL_VERDICT, branch: 'return' } });
  expect(diffs).toEqual([DIFF]);
});

test('a failing or invalid model answer falls back to the deterministic reviewer', async () => {
  for (const review of [() => Promise.reject(new Error('PROVIDER_FAILED')), () => Promise.resolve({ accept: 'maybe' })]) {
    const { deps } = harness({ review });
    const reply = await handleDemoRun(post('203.0.113.9'), deps);
    expect(reply.status).toBe(200);
    expect(JSON.stringify(reply.body)).toContain('No model was called');
  }
});

test('the model is not called for a refused request', async () => {
  let calls = 0;
  const { deps } = harness({ review: () => { calls += 1; return Promise.resolve(MODEL_VERDICT); } });
  await handleDemoRun(post('203.0.113.9'), deps);
  await handleDemoRun(post('203.0.113.9'), deps);
  await handleDemoRun(post('203.0.113.10', { githubToken: TOKEN }), deps);
  expect(calls).toBe(1);
});
