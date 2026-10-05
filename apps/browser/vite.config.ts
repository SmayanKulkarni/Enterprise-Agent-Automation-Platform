import '../../packages/telemetry/src/browser-api.js';
import type { IncomingHttpHeaders } from 'node:http';
import { defineConfig } from 'vite';
import { localBrowserTransport, localWebhookIngress } from '../../packages/browser/src/local-browser-host.js';
import { ingressResponse } from '../../packages/workflow/src/ingress-outcome.js';

const proxyTarget = process.env['PLATFORM_API_PROXY_TARGET'] || undefined;
const allowedOrigins = (environment: Readonly<Record<string, string | undefined>>) => (environment['CLERK_AUTHORIZED_PARTIES'] ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
const headers = (input: IncomingHttpHeaders, origin: string | undefined): Record<string, string | undefined> => {
  const result: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(input)) result[name] = Array.isArray(value) ? value[0] : value;
  if (origin !== undefined) result['origin'] = origin;
  return result;
};
const readBody = async (request: AsyncIterable<Uint8Array>): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
};

export default defineConfig(() => ({
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    ...(proxyTarget === undefined ? {} : { proxy: { '/api/workflow-webhook': { target: proxyTarget }, '/api/v1': { target: proxyTarget, configure: (proxy: { on: (event: 'proxyReq', handler: (request: { getHeader: (name: string) => unknown; setHeader: (name: string, value: string) => void }) => void) => void }) => { proxy.on('proxyReq', (request) => { if (request.getHeader('origin') === undefined) request.setHeader('origin', 'http://localhost:5173'); }); } } } }),
  },
  plugins: [{
    name: 'platform-browser-api',
    configureServer(server) {
      if (proxyTarget !== undefined) return;
      const environment = process.env;
      const origins = allowedOrigins(environment);
      const transport = process.env['VITEST'] === 'true' ? undefined : localBrowserTransport(environment);
      server.middlewares.use('/api/workflow-webhook', (request, response) => { void (async () => {
        const ingress = localWebhookIngress();
        const [tenantId = '', definitionId = ''] = (request.url ?? '').split('?')[0]!.split('/').filter(Boolean);
        if (ingress === undefined || request.method !== 'POST') { response.writeHead(ingress === undefined ? 503 : 405); response.end(); return; }
        const delivered = await ingress({ tenantId, definitionId, headers: headers(request.headers, undefined), body: await readBody(request) });
        const reply = ingressResponse(delivered);
        response.writeHead(reply.status, { 'content-type': reply.contentType });
        response.end(JSON.stringify(reply.body));
      })().catch((error: unknown) => { console.error('Local webhook ingress failed:', error instanceof Error ? `${'code' in error ? String(error.code) : 'UNKNOWN'} ${error.message}` : 'UNKNOWN'); const reply = ingressResponse(undefined); response.writeHead(reply.status, { 'content-type': reply.contentType }); response.end(JSON.stringify(reply.body)); }); });
      server.middlewares.use('/api/v1', (request, response) => { void (async () => {
        if (transport === undefined) { response.writeHead(503); response.end(); return; }
        const origin = request.headers.origin ?? `http://${request.headers.host ?? ''}`;
        const trustedOrigin = origins.includes(origin) ? origin : undefined;
        const body = request.method === 'POST' ? await readBody(request) : undefined;
        const result = await transport.handle({ method: request.method === 'POST' ? 'POST' : 'GET', path: `/api/v1${request.url ?? '/'}`, headers: headers(request.headers, trustedOrigin), ...(body === undefined ? {} : { body }) });
        response.writeHead(result.status, result.headers);
        response.end(result.body);
      })().catch((error: unknown) => { console.error('Local browser API failed:', error instanceof Error && 'code' in error ? error.code : 'UNKNOWN'); response.writeHead(503); response.end(); }); });
    },
  }],
}));
