import { createServer } from 'node:http';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { runSmoke, withRetry } from './smoke.mjs';

const ORIGIN = 'https://app.example';
const html = '<html><div id="root"></div></html>';
let servers;
let broken = false;

const listen = (handler) => new Promise((resolve) => {
  const server = createServer(handler).listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
});

beforeAll(async () => {
  const web = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }).end(broken ? '<html></html>' : html);
  });
  const api = await listen((request, response) => {
    if (request.method === 'OPTIONS') return request.headers.origin === ORIGIN ? response.writeHead(204, { 'access-control-allow-origin': ORIGIN }).end() : response.writeHead(403).end();
    return response.writeHead(401).end();
  });
  servers = { web, api };
});

afterAll(() => Promise.all(Object.values(servers).map(({ server }) => new Promise((done) => server.close(done)))));

test('passes every tier-one check against a healthy deployment', async () => {
  const results = await runSmoke({ web: servers.web.url, api: servers.api.url, origin: ORIGIN });
  expect(results.filter((result) => !result.ok)).toEqual([]);
  expect(results).toHaveLength(5);
});

test('reports the failing check when the web app root is missing', async () => {
  broken = true;
  const results = await runSmoke({ web: servers.web.url, api: servers.api.url, origin: ORIGIN });
  broken = false;
  expect(results.filter((result) => !result.ok).map((result) => result.name)).toEqual(['web / serves the app root with security headers', 'web /governance serves the SPA rewrite']);
});

test('retries a failing step with backoff until it succeeds', async () => {
  const delays = [];
  let calls = 0;
  const value = await withRetry(() => { calls += 1; if (calls < 3) throw new Error('cold start'); return 'ok'; }, 60_000, (ms) => { delays.push(ms); return Promise.resolve(); });
  expect(value).toBe('ok');
  expect(delays).toEqual([1000, 2000]);
});

test('gives up with the last error once the retry window is spent', async () => {
  await expect(withRetry(() => Promise.reject(new Error('still down')), 0)).rejects.toThrow('still down');
});
