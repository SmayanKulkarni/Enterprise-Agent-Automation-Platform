import type { IncomingHttpHeaders } from 'node:http';
import { defineConfig } from 'vite';
import { localBrowserTransport } from '../../packages/browser/src/local-browser-host.js';

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
  server: { host: 'localhost', port: 5173, strictPort: true },
  plugins: [{
    name: 'platform-browser-api',
    configureServer(server) {
      const environment = process.env;
      const origins = allowedOrigins(environment);
      const transport = process.env['VITEST'] === 'true' ? undefined : localBrowserTransport(environment);
      server.middlewares.use('/api/v1', (request, response) => { void (async () => {
        if (transport === undefined) { response.writeHead(503); response.end(); return; }
        const origin = request.headers.origin ?? `http://${request.headers.host ?? ''}`;
        const trustedOrigin = origins.includes(origin) ? origin : undefined;
        const body = request.method === 'POST' ? await readBody(request) : undefined;
        const result = await transport.handle({ method: request.method === 'POST' ? 'POST' : 'GET', path: `/api/v1${request.url ?? '/'}`, headers: headers(request.headers, trustedOrigin), ...(body === undefined ? {} : { body }) });
        response.writeHead(result.status, result.headers);
        response.end(result.body);
      })().catch(() => { response.writeHead(500); response.end(); }); });
    },
  }],
}));
