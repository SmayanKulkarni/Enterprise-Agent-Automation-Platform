import { localBrowserTransport } from './local-browser-host.js';
import type { ClerkBackend } from './index.js';

const mediaType = 'application/vnd.platform.browser.v1+json';

export async function browserResponse(request: Request, environment: Readonly<Record<string, string | undefined>> = process.env, backend?: ClerkBackend): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return new Response(null, { status: 405 });
  const headers = Object.fromEntries(request.headers.entries());
  if (request.method === 'GET' && headers['origin'] === undefined) headers['origin'] = new URL(request.url).origin;
  try {
    const result = await localBrowserTransport(environment, backend).handle({
      method: request.method,
      path: `${new URL(request.url).pathname}${new URL(request.url).search}`,
      headers,
      ...(request.method === 'POST' ? { body: new Uint8Array(await request.arrayBuffer()) } : {}),
    });
    return new Response(new TextDecoder().decode(result.body), { status: result.status, headers: result.headers });
  } catch {
    return new Response(JSON.stringify({ error: 'Service unavailable.' }), { status: 503, headers: { 'content-type': mediaType } });
  }
}
