import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import * as df from 'durable-functions';
import { browserResponse } from '../../../packages/browser/src/browser-response.js';
import { withErrorBoundary } from '../../../packages/errors/src/boundary.js';
import { withFlush } from '../../../packages/telemetry/src/index.js';
import { clientIp, handleDemoRun } from '../../../packages/browser/src/demo-run.js';
import { demoLimiter } from '../../../packages/browser/src/demo-limit.js';
import { handleDemoRead } from '../../../packages/browser/src/demo-read.js';
import { backendsFromEnvironment } from '../../../packages/governance/src/backend.js';
import { GovernanceService } from '../../../packages/governance/src/service.js';
import { AzureSqlDemoStore } from '../../../packages/browser/src/demo-store.js';
import { demoReviewer } from '../../../packages/workflow/src/pr-gate-demo-review.js';
import { durableDemoClaims } from './demo-claim.js';
import { durableScheduler } from './workflow-run.js';

const DEMO_RUN_PATH = /^\/(?:api\/)?v1\/demo\/run\/?$/u;
const DEMO_READ_PATH = /^\/(?:api\/)?v1\/demo\/(run|governance\/(?:overview|workflows|series|logs|trace))\/?$/u;
const DEMO_MAX_BODY_BYTES = 4096;
const DEMO_LIMITS = { perKey: 60, global: 600, windowMs: 60_000 };
const allowDemoRead = demoLimiter(DEMO_LIMITS);
const DEFAULT_DEMO_PEPPER = 'threadline-demo-claim';
const noClaims = async (): Promise<boolean> => { throw new Error('NO_DURABLE_CLIENT'); };

const allowedOrigins = () => new Set((process.env['CLERK_AUTHORIZED_PARTIES'] ?? '').split(',').map((origin) => origin.trim()).filter(Boolean));
const cors = (origin: string | null): Record<string, string> | undefined => origin !== null && allowedOrigins().has(origin) ? {
  'access-control-allow-origin': origin,
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'accept, authorization, content-type, idempotency-key, if-match, x-correlation-id, x-platform-tenant',
  'access-control-max-age': '600',
  vary: 'Origin',
} : undefined;

async function demoRun(request: HttpRequest, context: InvocationContext | undefined, crossOrigin: Record<string, string> | undefined): Promise<HttpResponseInit> {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', ...(crossOrigin ?? {}) };
  if (Number(request.headers.get('content-length') ?? 0) > DEMO_MAX_BODY_BYTES) return { status: 413, headers, body: JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'The request is too large.' } }) };
  const connectionString = process.env['AZURE_SQL_CONNECTION_STRING']?.trim();
  const store = connectionString ? new AzureSqlDemoStore(connectionString) : undefined;
  const claims = context ? durableDemoClaims(context) : { claimed: noClaims, claim: noClaims };
  const reply = await handleDemoRun({ ip: clientIp(request.headers.get('x-forwarded-for')), body: await request.text() }, { ...claims, fetch: (url, init) => fetch(url, init), review: demoReviewer(process.env, (url, init) => fetch(url, init)), save: store && ((key, run) => store.write(key, run)), now: Date.now, id: () => crypto.randomUUID(), pepper: process.env['DEMO_IP_PEPPER'] || DEFAULT_DEMO_PEPPER });
  return { status: reply.status, headers, body: JSON.stringify(reply.body) };
}

async function demoRead(request: HttpRequest, target: string, crossOrigin: Record<string, string> | undefined): Promise<HttpResponseInit> {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', ...(crossOrigin ?? {}) };
  const connectionString = process.env['AZURE_SQL_CONNECTION_STRING']?.trim();
  if (!connectionString) return { status: 503, headers, body: JSON.stringify({ error: { code: 'DEMO_UNAVAILABLE', message: 'The demo is temporarily unavailable.' } }) };
  const store = new AzureSqlDemoStore(connectionString);
  const governance = new GovernanceService(undefined, Date.now, backendsFromEnvironment(process.env));
  const reply = await handleDemoRead({ ip: clientIp(request.headers.get('x-forwarded-for')), target: target.replace(/^governance\//u, ''), query: Object.fromEntries(new URL(request.url).searchParams) }, { own: (key) => store.own(key), summary: (from, to, bucket) => store.summary(from, to, bucket), governance, allow: allowDemoRead, now: Date.now, pepper: process.env['DEMO_IP_PEPPER'] || DEFAULT_DEMO_PEPPER });
  return { status: reply.status, headers, body: JSON.stringify(reply.body) };
}

export const browserApi = withFlush(withErrorBoundary(async (request: HttpRequest, context?: InvocationContext): Promise<HttpResponseInit> => {
  const crossOrigin = cors(request.headers.get('origin'));
  if (request.method === 'OPTIONS') return crossOrigin === undefined ? { status: 403 } : { status: 204, headers: crossOrigin };

  if (request.method === 'POST' && DEMO_RUN_PATH.test(new URL(request.url).pathname)) return demoRun(request, context, crossOrigin);

  const demoTarget = request.method === 'GET' ? DEMO_READ_PATH.exec(new URL(request.url).pathname)?.[1] : undefined;
  if (demoTarget !== undefined) return demoRead(request, demoTarget, crossOrigin);

  const response = await browserResponse(new Request(request.url, { method: request.method, headers: request.headers, ...(request.method === 'POST' ? { body: await request.arrayBuffer() } : {}) }), process.env, undefined, context ? durableScheduler(context) : undefined);
  return { status: response.status, headers: { ...Object.fromEntries(response.headers.entries()), ...(crossOrigin ?? {}) }, body: await response.text() };
}, { headers: (request) => cors(request.headers.get('origin')) }));

app.http('browserApi', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'v1/{*path}', extraInputs: [df.input.durableClient()], handler: browserApi });
