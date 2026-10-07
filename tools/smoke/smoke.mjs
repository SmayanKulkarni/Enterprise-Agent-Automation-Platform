import { createClerkClient } from '@clerk/backend';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const MEDIA_TYPE = 'application/vnd.platform.browser.v1+json';
const RETRY_WINDOW_MS = 180_000;
const MAX_BACKOFF_MS = 15_000;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const trim = (url) => url.replace(/\/+$/u, '');

const check = (name, run) => async () => {
  try { await run(); return { name, ok: true }; } catch (error) { return { name, ok: false, detail: error.message }; }
};

const expectStatus = (response, status) => {
  if (response.status !== status) throw new Error(`expected ${status}, got ${response.status}`);
};

const expectHtml = async (response, needle) => {
  expectStatus(response, 200);
  if (!(response.headers.get('content-type') ?? '').includes('text/html')) throw new Error('not html');
  if (needle !== undefined && !(await response.text()).includes(needle)) throw new Error(`missing ${needle}`);
};

const tierOne = ({ web, api, origin }) => [
  check('web / serves the app root with security headers', async () => {
    const response = await fetch(`${web}/`);
    await expectHtml(response, 'id="root"');
    if (response.headers.get('x-content-type-options') !== 'nosniff') throw new Error('missing X-Content-Type-Options');
    if (!response.headers.get('referrer-policy')) throw new Error('missing Referrer-Policy');
  }),
  check('web /governance serves the SPA rewrite', async () => expectHtml(await fetch(`${web}/governance`), 'id="root"')),
  check('api preflight echoes the allowed origin', async () => {
    const response = await fetch(`${api}/api/v1/tenants`, { method: 'OPTIONS', headers: { origin } });
    expectStatus(response, 204);
    if (response.headers.get('access-control-allow-origin') !== origin) throw new Error('origin not echoed');
  }),
  check('api preflight refuses a foreign origin', async () => expectStatus(await fetch(`${api}/api/v1/tenants`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), 403)),
  check('api rejects an unauthenticated request', async () => expectStatus(await fetch(`${api}/api/v1/tenants`, { headers: { origin } }), 401)),
];

const demoGet = async ({ api, origin }, path) => {
  const response = await fetch(`${api}/api/v1/demo/${path}`, { headers: { accept: 'application/json', origin } });
  if (response.headers.get('access-control-allow-origin') !== origin) throw new Error('origin not echoed');
  return { response, body: await response.json().catch(() => ({})) };
};

const tierDemo = (options) => [
  check('api demo run lookup answers anonymously for the caller address', async () => {
    await withRetry(async () => {
      const { response, body } = await demoGet(options, 'run');
      if (response.status !== 200 && !(response.status === 404 && body?.error?.code === 'NOT_FOUND')) throw new Error(`expected 200 or 404 NOT_FOUND, got ${response.status} ${body?.error?.code ?? ''}`.trim());
    }, options.demoRetryWindowMs ?? RETRY_WINDOW_MS);
  }),
  check('api demo governance overview reads the stored run counts', async () => {
    const { response, body } = await demoGet(options, 'governance/overview?range=24h');
    expectStatus(response, 200);
    if (typeof body?.total?.runs !== 'number') throw new Error('no run total');
  }),
  check('api demo governance telemetry reads are served for the demo tenant', async () => {
    const { response, body } = await demoGet(options, 'governance/series?panel=model-latency&range=24h');
    expectStatus(response, 200);
    if (body?.status !== 'ready') throw new Error(`telemetry status ${body?.status}`);
  }),
];

const sessionToken = async (userId, origin) => {
  if (process.env.CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_')) {
    process.env.E2E_BASE = origin;
    return (await import('../e2e/clerk.mjs')).tokenFor(userId);
  }
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const session = await clerk.sessions.createSession({ userId });
  return (await clerk.sessions.getToken(session.id)).jwt;
};

export const withRetry = async (run, windowMs, sleepFn = sleep) => {
  const deadline = Date.now() + windowMs;
  for (let attempt = 0; ; attempt += 1) {
    try { return await run(); } catch (error) {
      if (Date.now() + 1000 >= deadline) throw error;
      await sleepFn(Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS));
    }
  }
};

const tierTwo = ({ api, origin, tenantId, userId, retryWindowMs = RETRY_WINDOW_MS }) => [
  check('api lists the smoke tenant for an authenticated user', async () => {
    const token = await sessionToken(userId, origin);
    await withRetry(async () => {
      const response = await fetch(`${api}/api/v1/tenants`, { headers: { accept: MEDIA_TYPE, origin, authorization: `Bearer ${token}` } });
      expectStatus(response, 200);
      if (!(await response.text()).includes(tenantId)) throw new Error(`tenant ${tenantId} not listed`);
    }, retryWindowMs);
  }),
];

const GRAFANA_PROBES = { prometheus: '/api/v1/query?query=1', loki: '/loki/api/v1/labels', tempo: '/api/echo' };

const tierThree = ({ grafana: { urls, users, token } }) => Object.entries(GRAFANA_PROBES).map(([name, path]) => check(`grafana ${name} accepts the query credentials`, async () => {
  const authorization = `Basic ${Buffer.from(`${users[name]}:${token}`).toString('base64')}`;
  expectStatus(await fetch(`${urls[name]}${path}`, { headers: { authorization } }), 200);
}));

export const grafanaFromEnv = (env) => {
  const urls = { prometheus: env.GOVERNANCE_PROMETHEUS_URL, loki: env.GOVERNANCE_LOKI_URL, tempo: env.GOVERNANCE_TEMPO_URL };
  const userFor = (label) => env[`GOVERNANCE_${label}_USER`] || env.GOVERNANCE_QUERY_USER;
  const users = { prometheus: userFor('PROMETHEUS'), loki: userFor('LOKI'), tempo: userFor('TEMPO') };
  const token = env.GOVERNANCE_QUERY_TOKEN;
  if (!token || !Object.values(users).every(Boolean) || !Object.values(urls).every(Boolean)) return undefined;
  return { urls: Object.fromEntries(Object.entries(urls).map(([name, url]) => [name, trim(url)])), users, token };
};

export async function runSmoke(options) {
  const checks = [...tierOne(options), ...tierDemo(options), ...(options.tenantId && options.userId ? tierTwo(options) : []), ...(options.grafana ? tierThree(options) : [])];
  const results = [];
  for (const run of checks) results.push(await run());
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { web: { type: 'string' }, api: { type: 'string' }, origin: { type: 'string' } } });
  for (const name of ['web', 'api', 'origin']) if (!values[name]) throw new Error(`Missing --${name}.`);
  const results = await runSmoke({ web: trim(values.web), api: trim(values.api), origin: trim(values.origin), tenantId: process.env.SMOKE_TENANT_ID, userId: process.env.SMOKE_CLERK_USER_ID, grafana: grafanaFromEnv(process.env) });
  for (const { name, ok, detail } of results) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: ${detail}`}`);
  process.exit(results.every((result) => result.ok) ? 0 : 1);
}
