import { afterEach, expect, test, vi } from 'vitest';
import { envMcpCredentials } from './mcp-credentials.js';
import { HttpMcpPort } from './ports.js';
import type { Installation } from './service.js';

const installation = { id: '6a000000-0000-4000-8000-0000000000b2', route: 'public', endpoint: 'https://mcp.example/mcp', health: 'healthy', manifest: { digest: 'd', version: '1', certified: true, capabilities: [] } } as Installation;
const deadline = () => new Date(Date.now() + 5000).toISOString();

afterEach(() => vi.unstubAllGlobals());

test('environment lookup resolves the per-installation variable and nothing else', async () => {
  const lookup = envMcpCredentials({ WORKFLOW_MCP_CREDENTIAL_6A0000000000400080000000000000B2: 'env-token' });
  expect(await lookup.resolve('t1', installation.id)).toBe('env-token');
  expect(await lookup.resolve('t1', '11111111-1111-4111-8111-111111111111')).toBeUndefined();
});

test('dispatch uses the injected lookup with the tenant and installation', async () => {
  const seen: string[] = [];
  const credentials = { resolve: (tenantId: string, installationId: string) => { seen.push(`${tenantId}/${installationId}`); return Promise.resolve('injected'); } };
  const headers: Record<string, string>[] = [];
  vi.stubGlobal('fetch', (_url: URL, init: { headers: Record<string, string> }) => { headers.push(init.headers); return Promise.resolve(new Response(JSON.stringify({ jsonrpc: '2.0', id: 'e1', result: { structuredContent: { ok: true } } }), { status: 200 })); });
  const port = new HttpMcpPort({ WORKFLOW_MCP_ALLOWED_HOSTS: 'mcp.example' }, credentials);
  expect((await port.invoke({ ...installation, tenantId: 't1' }, 't', {}, 'e1', deadline())).outcome).toBe('succeeded');
  expect(seen).toEqual([`t1/${installation.id}`]);
  expect(headers[0]?.['authorization']).toBe('Bearer injected');
});

test('no credential from the lookup means not-dispatched', async () => {
  vi.stubGlobal('fetch', () => { throw new Error('must not call'); });
  const port = new HttpMcpPort({ WORKFLOW_MCP_ALLOWED_HOSTS: 'mcp.example' }, { resolve: () => Promise.resolve(undefined) });
  expect(await port.invoke(installation, 't', {}, 'e1', deadline())).toEqual({ outcome: 'not-dispatched' });
});
