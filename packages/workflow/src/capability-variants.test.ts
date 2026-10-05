import { afterEach, expect, test, vi } from 'vitest';
import { digest } from '../../contracts/src/index.js';
import { HttpMcpPort } from './ports.js';
import { WorkflowService, type Installation } from './service.js';
import { MemoryRecords, INSTALLATION, TENANT, asStore, contextFor, shape } from './worker-harness.test-support.js';

afterEach(() => vi.unstubAllGlobals());

const ADMIN = '55555555-5555-4555-8555-555555555555';
const environment = { WORKFLOW_MCP_ALLOWED_HOSTS: 'mcp.example', WORKFLOW_MCP_CREDENTIAL_33333333333343338333333333333333: 'token' };
const capability = { name: 'pull_request_get_diff', risk: 'R1' as const, tool: 'pull_request_read', fixed: { method: 'get_diff' }, inputSchema: shape({ owner: { type: 'string' }, repo: { type: 'string' }, pullNumber: { type: 'number' } }), outputSchema: shape({ result: { type: 'string' } }) };

const installationOf = async (extra: Record<string, unknown> = {}): Promise<Installation> => {
  const manifest = { version: '1', capabilities: [{ ...capability, ...extra }] };
  return { id: INSTALLATION, route: 'public', endpoint: 'https://mcp.example/mcp', health: 'healthy', manifest: { ...manifest, certified: true, digest: await digest(manifest) } } as Installation;
};

test('a variant calls the underlying tool and always sends its fixed arguments', async () => {
  const sent: unknown[] = [];
  vi.stubGlobal('fetch', (_url: URL, init: { body: string }) => { sent.push(JSON.parse(init.body)); return Promise.resolve(new Response(JSON.stringify({ jsonrpc: '2.0', id: 'e1', result: { structuredContent: { result: 'diff' } } }), { status: 200, headers: { 'content-type': 'application/json' } })); });
  const outcome = await new HttpMcpPort(environment).invoke(await installationOf(), 'pull_request_get_diff', { owner: 'o', repo: 'r', pullNumber: 7, method: 'get_status' }, 'e1', new Date(Date.now() + 5000).toISOString());
  expect(outcome.outcome).toBe('succeeded');
  expect(sent[0]).toMatchObject({ method: 'tools/call', params: { name: 'pull_request_read', arguments: { owner: 'o', repo: 'r', pullNumber: 7, method: 'get_diff' } } });
});

test('a plain capability still calls the tool of the same name', async () => {
  const sent: unknown[] = [];
  vi.stubGlobal('fetch', (_url: URL, init: { body: string }) => { sent.push(JSON.parse(init.body)); return Promise.resolve(new Response(JSON.stringify({ jsonrpc: '2.0', id: 'e1', result: { structuredContent: { result: 'x' } } }), { status: 200, headers: { 'content-type': 'application/json' } })); });
  const plain = await installationOf(); const { tool: _tool, fixed: _fixed, ...rest } = plain.manifest.capabilities[0] as Record<string, unknown>;
  await new HttpMcpPort(environment).invoke({ ...plain, manifest: { ...plain.manifest, capabilities: [rest as never] } }, 'pull_request_get_diff', { owner: 'o' }, 'e1', new Date(Date.now() + 5000).toISOString());
  expect(sent[0]).toMatchObject({ params: { name: 'pull_request_get_diff', arguments: { owner: 'o' } } });
});

const certify = async (extra: Record<string, unknown>) => {
  const records = new MemoryRecords(); records.profiles.set(ADMIN, ['admin']);
  const service = new WorkflowService({} as never, asStore(records), undefined);
  return service.certify(contextFor(ADMIN), INSTALLATION, await installationOf(extra), 0, '11111111-1111-4111-8111-111111111111', 'digest');
};

test('certify accepts a well-formed variant', async () => {
  await expect(certify({})).resolves.toBeUndefined();
});

test.each([
  ['a fixed argument that is also an input', { fixed: { owner: 'x' } }],
  ['a non-scalar fixed argument', { fixed: { method: { a: 1 } } }],
  ['fixed that is not an object', { fixed: 'get_diff' }],
  ['a tool name that is not text', { tool: 5 }],
  ['an empty tool name', { tool: '' }],
])('certify refuses %s', async (_label, extra) => {
  await expect(certify(extra)).rejects.toMatchObject({ code: 'INVALID' });
});

test('an admin can retire an installation and it can then no longer be certified or called', async () => {
  const records = new MemoryRecords(); records.profiles.set(ADMIN, ['admin']);
  const service = new WorkflowService({} as never, asStore(records), undefined);
  const key = '11111111-1111-4111-8111-111111111111'; const retireKey = '22222222-2222-4222-8222-222222222222';
  await service.certify(contextFor(ADMIN), INSTALLATION, await installationOf(), 0, key, 'digest');
  await service.retire(contextFor(ADMIN), INSTALLATION, 1, retireKey, 'retire-digest');
  const after = (await records.workerRead<Installation>(TENANT, 'installation', INSTALLATION))!;
  expect(after).toMatchObject({ state: 'revoked', data: { health: 'revoked' } });
  await expect(service.certify(contextFor(ADMIN), INSTALLATION, await installationOf(), 2, '33333333-3333-4333-8333-333333333334', 'digest')).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(service.retire(contextFor(ADMIN), INSTALLATION, 1, '44444444-4444-4444-8444-444444444444', 'again')).rejects.toMatchObject({ code: 'STALE' });
});

test('retiring needs an admin and an installation that exists', async () => {
  const records = new MemoryRecords(); records.profiles.set(ADMIN, ['admin']); records.profiles.set('66666666-6666-4666-8666-666666666666', ['editor']);
  const service = new WorkflowService({} as never, asStore(records), undefined);
  await expect(service.retire(contextFor(ADMIN), INSTALLATION, 1, '55555555-5555-4555-8555-555555555556', 'd')).rejects.toMatchObject({ code: 'STALE' });
  await expect(service.retire(contextFor('66666666-6666-4666-8666-666666666666'), INSTALLATION, 1, '55555555-5555-4555-8555-555555555557', 'd')).rejects.toMatchObject({ code: 'DENIED' });
});
