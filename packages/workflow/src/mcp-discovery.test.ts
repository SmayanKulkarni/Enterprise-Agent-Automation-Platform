import { afterEach, expect, test, vi } from 'vitest';
import { parseToolList } from './mcp-discovery.js';
import { HttpMcpPort } from './ports.js';
import { WorkflowService } from './service.js';
import { INSTALLATION, MemoryRecords, TENANT, asStore, contextFor } from './worker-harness.test-support.js';

const ENDPOINT = 'https://mcp.example/mcp';
const tool = (extra: Record<string, unknown> = {}) => ({ name: 'create_issue', description: 'Create an issue', inputSchema: { type: 'object', properties: { title: { type: 'string' }, count: { type: 'integer' }, labels: { type: 'array' }, meta: { type: 'object' }, draft: { type: 'boolean' }, odd: { type: ['string', 'null'] } }, required: ['title'] }, ...extra });
const code = (promise: Promise<unknown>) => promise.then(() => 'ok', (error: unknown) => (error as { code?: string }).code);
const deadline = 5000;

afterEach(() => vi.unstubAllGlobals());

test('parses tools into typed fields and defaults every tool to the most restrictive risk', () => {
  expect(parseToolList({ tools: [tool()] })).toEqual([{ name: 'create_issue', description: 'Create an issue', risk: 'R3', fields: [
    { name: 'title', type: 'string', required: true }, { name: 'count', type: 'number', required: false }, { name: 'labels', type: 'array', required: false },
    { name: 'meta', type: 'object', required: false }, { name: 'draft', type: 'boolean', required: false }, { name: 'odd', type: 'string', required: false },
  ] }]);
});

test('accepts a tool with no input properties and ignores a risk the server claims', () => {
  expect(parseToolList({ tools: [{ name: 'ping', risk: 'R1', inputSchema: { type: 'object' } }] })).toEqual([{ name: 'ping', risk: 'R3', fields: [] }]);
});

test.each([
  ['a non-object result', 'nope'],
  ['no tools array', {}],
  ['a tool without a name', { tools: [{ inputSchema: { type: 'object' } }] }],
  ['a duplicate name', { tools: [tool(), tool()] }],
  ['an oversize name', { tools: [tool({ name: 'x'.repeat(129) })] }],
  ['no tools at all', { tools: [] }],
  ['too many tools', { tools: Array.from({ length: 101 }, (_, index) => tool({ name: `t${String(index)}` })) }],
  ['a non-object input schema', { tools: [tool({ inputSchema: 'x' })] }],
])('rejects %s', (_name, result) => {
  expect(() => parseToolList(result)).toThrow(expect.objectContaining({ code: 'INVALID' }));
});

const reply = (body: unknown, init: ResponseInit = { status: 200 }) => Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), init));
const port = (token: string | null = 'stored-token', allowed = 'mcp.example') => new HttpMcpPort({ WORKFLOW_MCP_ALLOWED_HOSTS: allowed }, { resolve: () => Promise.resolve(token ?? undefined) });

test('lists tools with the stored credential and never echoes it', async () => {
  const seen: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', (_url: URL, init: { headers: Record<string, string>; body: string }) => { seen.push({ headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> }); return reply({ jsonrpc: '2.0', id: (JSON.parse(init.body) as { id: string }).id, result: { tools: [tool()] } }); });
  const tools = await port().listTools(TENANT, INSTALLATION, ENDPOINT, deadline);
  expect(tools[0]?.name).toBe('create_issue');
  expect(seen[0]?.headers['authorization']).toBe('Bearer stored-token');
  expect(seen[0]?.body).toMatchObject({ method: 'tools/list' });
  expect(JSON.stringify(tools)).not.toContain('stored-token');
});

test('reads an event-stream reply', async () => {
  vi.stubGlobal('fetch', (_url: URL, init: { body: string }) => reply(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: (JSON.parse(init.body) as { id: string }).id, result: { tools: [tool()] } })}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  expect((await port().listTools(TENANT, INSTALLATION, ENDPOINT, deadline)).length).toBe(1);
});

test('fails closed for a host off the allowlist, a non-https endpoint or a missing credential, without calling out', async () => {
  const fetcher = vi.fn(() => reply({}));
  vi.stubGlobal('fetch', fetcher);
  expect(await code(port(null, 'other.example').listTools(TENANT, INSTALLATION, ENDPOINT, deadline))).toBe('DENIED');
  expect(await code(port().listTools(TENANT, INSTALLATION, 'http://mcp.example/mcp', deadline))).toBe('DENIED');
  expect(await code(port(null).listTools(TENANT, INSTALLATION, ENDPOINT, deadline))).toBe('DENIED');
  expect(fetcher).not.toHaveBeenCalled();
});

test('an unreachable server, an error status and a malformed reply are distinct errors that never carry the token', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('connect ECONNREFUSED stored-token')));
  const unreachable = await port().listTools(TENANT, INSTALLATION, ENDPOINT, deadline).catch((error: unknown) => error as Error & { code?: string });
  expect(unreachable).toMatchObject({ code: 'UNAVAILABLE' });
  expect((unreachable as Error).message).not.toContain('stored-token');
  vi.stubGlobal('fetch', () => reply({}, { status: 500 }));
  expect(await code(port().listTools(TENANT, INSTALLATION, ENDPOINT, deadline))).toBe('UNAVAILABLE');
  vi.stubGlobal('fetch', () => reply('not json'));
  expect(await code(port().listTools(TENANT, INSTALLATION, ENDPOINT, deadline))).toBe('INVALID');
  vi.stubGlobal('fetch', (_url: URL, init: { body: string }) => reply({ jsonrpc: '2.0', id: (JSON.parse(init.body) as { id: string }).id, result: { tools: 'nope' } }));
  expect(await code(port().listTools(TENANT, INSTALLATION, ENDPOINT, deadline))).toBe('INVALID');
  vi.stubGlobal('fetch', () => reply({ jsonrpc: '2.0', id: 'someone-else', result: { tools: [tool()] } }));
  expect(await code(port().listTools(TENANT, INSTALLATION, ENDPOINT, deadline))).toBe('INVALID');
});

const setup = (options: { discovery?: boolean } = {}) => {
  const records = new MemoryRecords();
  records.profiles.set('admin-1', ['admin']);
  const listTools = vi.fn(() => Promise.resolve([{ name: 'ping', risk: 'R3' as const, fields: [] }]));
  const service = new WorkflowService(undefined as never, asStore(records), undefined, [], [], () => true, () => 'disabled', undefined, undefined, undefined, undefined, options.discovery === false ? undefined : { listTools });
  return { records, service, listTools };
};

test('an administrator discovers tools and nothing is written', async () => {
  const { records, service, listTools } = setup();
  const write = vi.spyOn(records, 'write');
  expect(await service.discoverTools(contextFor('admin-1'), INSTALLATION, ENDPOINT)).toEqual([{ name: 'ping', risk: 'R3', fields: [] }]);
  expect(listTools).toHaveBeenCalledWith(TENANT, INSTALLATION, ENDPOINT);
  expect(write).not.toHaveBeenCalled();
});

test('a non-administrator, a bad endpoint, a bad id and a missing port are refused before any outbound call', async () => {
  const { service, listTools } = setup();
  expect(await code(service.discoverTools(contextFor('editor-1'), INSTALLATION, ENDPOINT))).toBe('DENIED');
  for (const endpoint of ['http://mcp.example/mcp', 'https://user:pw@mcp.example/mcp', 'https://mcp.example/mcp#frag', 'not a url']) expect(await code(service.discoverTools(contextFor('admin-1'), INSTALLATION, endpoint))).toBe('INVALID');
  expect(await code(service.discoverTools(contextFor('admin-1'), 'not-a-uuid', ENDPOINT))).toBe('INVALID');
  expect(listTools).not.toHaveBeenCalled();
  expect(await code(setup({ discovery: false }).service.discoverTools(contextFor('admin-1'), INSTALLATION, ENDPOINT))).toBe('FEATURE_NOT_READY');
});
