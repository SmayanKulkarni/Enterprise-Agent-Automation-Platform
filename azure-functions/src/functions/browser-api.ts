import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { browserResponse } from '../../../packages/browser/src/browser-response.js';

const allowedOrigins = () => new Set((process.env['CLERK_AUTHORIZED_PARTIES'] ?? '').split(',').map((origin) => origin.trim()).filter(Boolean));
const cors = (origin: string | null): Record<string, string> | undefined => origin !== null && allowedOrigins().has(origin) ? {
  'access-control-allow-origin': origin,
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'accept, authorization, content-type, idempotency-key, if-match, x-correlation-id, x-platform-tenant',
  'access-control-max-age': '600',
  vary: 'Origin',
} : undefined;

export async function browserApi(request: HttpRequest): Promise<HttpResponseInit> {
  const crossOrigin = cors(request.headers.get('origin'));
  if (request.method === 'OPTIONS') return crossOrigin === undefined ? { status: 403 } : { status: 204, headers: crossOrigin };

  const response = await browserResponse(new Request(request.url, { method: request.method, headers: request.headers, ...(request.method === 'POST' ? { body: await request.arrayBuffer() } : {}) }));
  return { status: response.status, headers: { ...Object.fromEntries(response.headers.entries()), ...(crossOrigin ?? {}) }, body: await response.text() };
}

app.http('browserApi', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'v1/{*path}', handler: browserApi });
