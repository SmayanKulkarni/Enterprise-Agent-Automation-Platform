import { createServer } from 'node:http';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { grafanaFromEnv, runSmoke, withRetry } from './smoke.mjs';

const ORIGIN = 'https://app.example';
const html = '<html><div id="root"></div></html>';
let servers;
let broken = false;
let demoDown = false;

const listen = (handler) => new Promise((resolve) => {
  const server = createServer(handler).listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
});

beforeAll(async () => {
  const web = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }).end(broken ? '<html></html>' : html);
  });
  const api = await listen((request, response) => {
    if (request.method === 'OPTIONS') return request.headers.origin === ORIGIN ? response.writeHead(204, { 'access-control-allow-origin': ORIGIN }).end() : response.writeHead(403).end();
    if (request.url.startsWith('/api/v1/demo/')) {
      const headers = { 'content-type': 'application/json', 'access-control-allow-origin': ORIGIN };
      if (demoDown) return response.writeHead(503, headers).end(JSON.stringify({ error: { code: 'DEMO_UNAVAILABLE' } }));
      if (request.url === '/api/v1/demo/run') return response.writeHead(404, headers).end(JSON.stringify({ error: { code: 'NOT_FOUND' } }));
      if (request.url.startsWith('/api/v1/demo/governance/overview')) return response.writeHead(200, headers).end(JSON.stringify({ total: { runs: 4 } }));
      return response.writeHead(200, headers).end(JSON.stringify({ status: 'ready', series: [] }));
    }
    return response.writeHead(401).end();
  });
  const grafana = await listen((request, response) => {
    const expected = `Basic ${Buffer.from('stack:token').toString('base64')}`;
    return response.writeHead(request.headers.authorization === expected ? 200 : 401).end('{}');
  });
  servers = { web, api, grafana };
});

afterAll(() => Promise.all(Object.values(servers).map(({ server }) => new Promise((done) => server.close(done)))));

test('passes every tier-one check against a healthy deployment', async () => {
  const results = await runSmoke({ web: servers.web.url, api: servers.api.url, origin: ORIGIN });
  expect(results.filter((result) => !result.ok)).toEqual([]);
  expect(results).toHaveLength(8);
});

test('reports the failing check when the web app root is missing', async () => {
  broken = true;
  const results = await runSmoke({ web: servers.web.url, api: servers.api.url, origin: ORIGIN });
  broken = false;
  expect(results.filter((result) => !result.ok).map((result) => result.name)).toEqual(['web / serves the app root with security headers', 'web /governance serves the SPA rewrite']);
});

test('reports the demo checks that fail when the demo reads are unavailable', async () => {
  demoDown = true;
  const results = await runSmoke({ web: servers.web.url, api: servers.api.url, origin: ORIGIN, demoRetryWindowMs: 0 });
  demoDown = false;
  expect(results.filter((result) => !result.ok).map((result) => result.name)).toEqual(['api demo run lookup answers anonymously for the caller address', 'api demo governance overview reads the stored run counts', 'api demo governance telemetry reads are served for the demo tenant']);
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

const grafanaOptions = (token) => ({ web: servers.web.url, api: servers.api.url, origin: ORIGIN, grafana: { urls: { prometheus: servers.grafana.url, loki: servers.grafana.url, tempo: servers.grafana.url }, users: { prometheus: 'stack', loki: 'stack', tempo: 'stack' }, token } });

test('passes the Grafana checks when the query credentials are accepted', async () => {
  const results = await runSmoke(grafanaOptions('token'));
  expect(results.filter((result) => !result.ok)).toEqual([]);
  expect(results.filter((result) => result.name.startsWith('grafana '))).toHaveLength(3);
});

test('fails each Grafana check when the token is rejected', async () => {
  const results = await runSmoke(grafanaOptions('wrong'));
  expect(results.filter((result) => !result.ok).map((result) => result.name)).toEqual([
    'grafana prometheus accepts the query credentials',
    'grafana loki accepts the query credentials',
    'grafana tempo accepts the query credentials',
  ]);
});

test('reads the Grafana backends from the environment and trims trailing slashes', () => {
  const env = { GOVERNANCE_PROMETHEUS_URL: 'https://p.example/api/prom/', GOVERNANCE_LOKI_URL: 'https://l.example', GOVERNANCE_TEMPO_URL: 'https://t.example/tempo', GOVERNANCE_QUERY_USER: 'stack', GOVERNANCE_QUERY_TOKEN: 'token' };
  expect(grafanaFromEnv(env)).toEqual({ urls: { prometheus: 'https://p.example/api/prom', loki: 'https://l.example', tempo: 'https://t.example/tempo' }, users: { prometheus: 'stack', loki: 'stack', tempo: 'stack' }, token: 'token' });
});

test('skips the Grafana checks when any backend setting is missing', () => {
  const env = { GOVERNANCE_PROMETHEUS_URL: 'https://p.example', GOVERNANCE_LOKI_URL: 'https://l.example', GOVERNANCE_QUERY_USER: 'stack', GOVERNANCE_QUERY_TOKEN: 'token' };
  expect(grafanaFromEnv(env)).toBeUndefined();
  expect(grafanaFromEnv({ ...env, GOVERNANCE_TEMPO_URL: 'https://t.example', GOVERNANCE_QUERY_TOKEN: '' })).toBeUndefined();
});

test('prefers a per-backend user over the shared query user', () => {
  const env = { GOVERNANCE_PROMETHEUS_URL: 'https://p.example', GOVERNANCE_LOKI_URL: 'https://l.example', GOVERNANCE_TEMPO_URL: 'https://t.example', GOVERNANCE_QUERY_USER: 'stack', GOVERNANCE_LOKI_USER: 'logs', GOVERNANCE_QUERY_TOKEN: 'token' };
  expect(grafanaFromEnv(env).users).toEqual({ prometheus: 'stack', loki: 'logs', tempo: 'stack' });
  expect(grafanaFromEnv({ ...env, GOVERNANCE_QUERY_USER: '' })).toBeUndefined();
});
