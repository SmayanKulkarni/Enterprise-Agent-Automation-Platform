import { afterEach, expect, test, vi } from 'vitest';
import { HttpMcpPort } from './ports.js';
import type { Installation } from './service.js';

const installation = { id: '6a000000-0000-4000-8000-0000000000b2', route: 'public', endpoint: 'https://mcp.example/mcp', health: 'healthy', manifest: { digest: 'd', version: '1', certified: true, capabilities: [] } } as Installation;
const environment = { WORKFLOW_MCP_ALLOWED_HOSTS: 'mcp.example', WORKFLOW_MCP_CREDENTIAL_6A0000000000400080000000000000B2: 'oauth-token' };
const deadline = () => new Date(Date.now() + 5000).toISOString();

afterEach(() => vi.unstubAllGlobals());

const seen: Record<string, string>[] = [];
const reply = (result: unknown, event = false) => (url: URL, init: { headers: Record<string, string> }) => { seen.push({ url: String(url), ...init.headers }); return Promise.resolve(new Response(event ? `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 'e1', result })}\n\n` : JSON.stringify({ jsonrpc: '2.0', id: 'e1', result }), { status: 200, headers: { 'content-type': event ? 'text/event-stream' : 'application/json' } })); };

test('sends the installation credential as bearer and wraps text-only JSON results', async () => {
  seen.length = 0;
  vi.stubGlobal('fetch', reply({ content: [{ type: 'text', text: '{"login":"octo"}' }] }, true));
  const outcome = await new HttpMcpPort(environment).invoke(installation, 'get_me', {}, 'e1', deadline());
  expect(outcome).toEqual({ outcome: 'succeeded', output: { result: { login: 'octo' } } });
  expect(seen[0]?.['authorization']).toBe('Bearer oauth-token');
});

test('keeps structuredContent as is, wraps plain text, and refuses error results', async () => {
  vi.stubGlobal('fetch', reply({ content: [], structuredContent: { ok: true } }));
  expect((await new HttpMcpPort(environment).invoke(installation, 't', {}, 'e1', deadline())).output).toEqual({ ok: true });
  vi.stubGlobal('fetch', reply({ content: [{ type: 'text', text: 'plain words' }] }));
  expect((await new HttpMcpPort(environment).invoke(installation, 't', {}, 'e1', deadline())).output).toEqual({ result: 'plain words' });
  vi.stubGlobal('fetch', reply({ isError: true, content: [{ type: 'text', text: 'boom' }] }));
  expect((await new HttpMcpPort(environment).invoke(installation, 't', {}, 'e1', deadline())).outcome).toBe('unknown-outcome');
});

test('an error result from a read-only capability is a definite failure; from any other risk it stays unknown', async () => {
  const withRisk = (risk: string) => ({ ...installation, manifest: { ...installation.manifest, capabilities: [{ name: 'lookup', risk }] } }) as unknown as Installation;
  vi.stubGlobal('fetch', reply({ isError: true, content: [{ type: 'text', text: 'not found' }] }));
  const invoke = (risk: string) => new HttpMcpPort(environment).invoke(withRisk(risk), 'lookup', {}, 'e1', deadline());
  expect((await invoke('R1')).outcome).toBe('failed');
  expect((await invoke('R2')).outcome).toBe('unknown-outcome');
  expect((await invoke('R3')).outcome).toBe('unknown-outcome');
});
