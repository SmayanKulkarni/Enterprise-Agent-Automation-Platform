import { localBrowserTransport } from './local-browser-host.js';
import type { ClerkBackend } from './index.js';
import type { Scheduler } from '../../workflow/src/service.js';
import { withErrorBoundary } from '../../errors/src/boundary.js';

export const browserResponse = withErrorBoundary(async (request: Request, environment: Readonly<Record<string, string | undefined>> = process.env, backend?: ClerkBackend, scheduler?: Scheduler): Promise<Response> => {
  if (request.method !== 'GET' && request.method !== 'POST') return new Response(null, { status: 405 });
  const headers = Object.fromEntries(request.headers.entries());
  if (request.method === 'GET' && headers['origin'] === undefined) headers['origin'] = new URL(request.url).origin;
  const result = await localBrowserTransport(environment, backend, scheduler).handle({
    method: request.method,
    path: `${new URL(request.url).pathname}${new URL(request.url).search}`,
    headers,
    ...(request.method === 'POST' ? { body: new Uint8Array(await request.arrayBuffer()) } : {}),
  });
  return new Response(new TextDecoder().decode(result.body), { status: result.status, headers: result.headers });
}, { kind: 'fetch' });
