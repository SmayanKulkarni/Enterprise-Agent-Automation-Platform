import { randomBytes } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { McpCredentialCrypto, envMcpCredentials, storedMcpCredentials, type McpCredentialRecord } from './mcp-credentials.js';
import { HttpMcpPort } from './ports.js';
import { WorkflowService, type Installation } from './service.js';
import { INSTALLATION, MemoryRecords, TENANT, asStore, contextFor, shape } from './worker-harness.test-support.js';
import type { WorkflowRecord } from './sql.js';

const OTHER_TENANT = '99999999-9999-4999-8999-999999999999';
const KEY = '55555555-5555-4555-8555-555555555555';
const crypto = new McpCredentialCrypto('v1', randomBytes(32));
const admin = contextFor('admin-1');
const installation: Installation = { id: INSTALLATION, route: 'public', endpoint: 'https://mcp.example/mcp', health: 'healthy', manifest: { digest: 'd', version: '1', certified: true, capabilities: [{ name: 't', risk: 'R1', inputSchema: shape({}), outputSchema: shape({}) }] } };

const setup = (environment: Record<string, string> = {}) => {
  const records = new MemoryRecords();
  records.records.set(`${TENANT}:installation:${INSTALLATION}`, { id: INSTALLATION, kind: 'installation', version: 1, state: 'healthy', data: installation });
  const store = asStore(records);
  const lookup = storedMcpCredentials(store, crypto, envMcpCredentials(environment));
  const service = new WorkflowService(undefined as never, store, undefined, [], [], (item, tenantId) => lookup.resolve(tenantId, item.id).then(Boolean), () => 'disabled', undefined, undefined, undefined, crypto);
  return { records, service, lookup, store };
};
const code = (promise: Promise<unknown>) => promise.then(() => 'ok', (error: unknown) => (error as { code?: string }).code);
const stored = (records: MemoryRecords) => records.records.get(`${TENANT}:mcp-credential:${INSTALLATION}`) as WorkflowRecord<McpCredentialRecord> | undefined;

afterEach(() => vi.unstubAllGlobals());

test('the seal is bound to tenant and installation', () => {
  const sealed = crypto.seal(TENANT, INSTALLATION, 'secret-token');
  expect(crypto.open(TENANT, INSTALLATION, sealed)).toBe('secret-token');
  expect(() => crypto.open(OTHER_TENANT, INSTALLATION, sealed)).toThrow();
  expect(() => crypto.open(TENANT, '66666666-6666-4666-8666-666666666666', sealed)).toThrow();
});

test('connect seals the token, never stores it in clear and never projects it', async () => {
  const { records, service } = setup();
  expect(await service.mcpCredential(admin, 'connect', INSTALLATION, 0, KEY, 'secret-token')).toMatchObject({ version: 1, state: 'active' });
  expect(JSON.stringify([...records.records.values()])).not.toContain('secret-token');
  const projected = JSON.stringify(await service.projection(admin, 'workflow-mcp-credentials'));
  expect(projected).not.toContain('secret-token');
  expect(projected).not.toContain('ciphertext');
  expect(projected).toContain(INSTALLATION);
});

test('only administrators connect, rotate or disconnect', async () => {
  const { records, service } = setup();
  records.profiles.set('admin-1', ['admin']);
  expect(await code(service.mcpCredential(contextFor('editor-1'), 'connect', INSTALLATION, 0, KEY, 'secret-token'))).toBe('DENIED');
  expect(stored(records)).toBeUndefined();
});

test('connect is allowed before certification, refused for a private or uncertified installation and for bad tokens', async () => {
  const { records, service } = setup();
  expect(await code(service.mcpCredential(admin, 'connect', '77777777-7777-4777-8777-777777777777', 0, KEY, 'x'))).toBe('ok');
  expect(await code(service.mcpCredential(admin, 'connect', INSTALLATION, 0, KEY, 'x'.repeat(4097)))).toBe('INVALID');
  expect(await code(service.mcpCredential(admin, 'connect', INSTALLATION, 0, KEY, ''))).toBe('INVALID');
  records.records.set(`${TENANT}:installation:${INSTALLATION}`, { id: INSTALLATION, kind: 'installation', version: 1, state: 'healthy', data: { ...installation, route: 'private' } });
  expect(await code(service.mcpCredential(admin, 'connect', INSTALLATION, 0, KEY, 'x'))).toBe('DENIED');
  records.records.set(`${TENANT}:installation:${INSTALLATION}`, { id: INSTALLATION, kind: 'installation', version: 1, state: 'healthy', data: { ...installation, manifest: { ...installation.manifest, certified: false } } });
  expect(await code(service.mcpCredential(admin, 'connect', INSTALLATION, 0, KEY, 'x'))).toBe('DENIED');
});

test('commands use expected-version concurrency and are idempotent on replay', async () => {
  const { records, service } = setup();
  await service.mcpCredential(admin, 'connect', INSTALLATION, 0, KEY, 'secret-token');
  await expect(service.mcpCredential(admin, 'connect', INSTALLATION, 0, KEY, 'secret-token')).resolves.toMatchObject({ version: 1, state: 'active' });
  expect(stored(records)?.version).toBe(1);
  expect(await code(service.mcpCredential(admin, 'rotate', INSTALLATION, 0, '88888888-8888-4888-8888-888888888888', 'next'))).toBe('STALE');
  expect(await code(service.mcpCredential(admin, 'rotate', INSTALLATION, 1, KEY, 'next'))).toBe('CONFLICT');
});

test('a tenant credential wins over the environment, disconnect falls back to it, tamper fails closed', async () => {
  const environment = { WORKFLOW_MCP_CREDENTIAL_33333333333343338333333333333333: 'env-token' };
  const { records, service, lookup } = setup(environment);
  expect(await lookup.resolve(TENANT, INSTALLATION)).toBe('env-token');
  await service.mcpCredential(admin, 'connect', INSTALLATION, 0, KEY, 'tenant-token');
  expect(await lookup.resolve(TENANT, INSTALLATION)).toBe('tenant-token');
  expect(await lookup.resolve(OTHER_TENANT, INSTALLATION)).toBe('env-token');
  await service.mcpCredential(admin, 'rotate', INSTALLATION, 1, '88888888-8888-4888-8888-888888888888', 'rotated-token');
  expect(await lookup.resolve(TENANT, INSTALLATION)).toBe('rotated-token');
  const record = stored(records);
  if (!record?.data.key) throw new Error('expected a stored credential');
  records.records.set(`${TENANT}:mcp-credential:${INSTALLATION}`, { ...record, data: { ...record.data, key: { ...record.data.key, ciphertext: Buffer.from('tampered').toString('base64url') } } });
  expect(await lookup.resolve(TENANT, INSTALLATION)).toBeUndefined();
  records.records.set(`${TENANT}:mcp-credential:${INSTALLATION}`, record);
  await service.mcpCredential(admin, 'disconnect', INSTALLATION, 2, '99999999-9999-4999-8999-999999999990');
  expect(await lookup.resolve(TENANT, INSTALLATION)).toBe('env-token');
});

test('dispatch uses the tenant credential with no environment variable, follows rotate and disconnect, and keeps the host allowlist', async () => {
  const { service, lookup } = setup();
  const bearers: string[] = [];
  vi.stubGlobal('fetch', (_url: URL, init: { headers: Record<string, string> }) => { bearers.push(init.headers['authorization'] ?? ''); return Promise.resolve(new Response(JSON.stringify({ jsonrpc: '2.0', id: 'e1', result: { structuredContent: { ok: true } } }), { status: 200 })); });
  const invoke = (allowed = 'mcp.example') => new HttpMcpPort({ WORKFLOW_MCP_ALLOWED_HOSTS: allowed }, lookup).invoke({ ...installation, tenantId: TENANT }, 't', {}, 'e1', new Date(Date.now() + 5000).toISOString());
  expect((await invoke()).outcome).toBe('not-dispatched');
  await service.mcpCredential(admin, 'connect', INSTALLATION, 0, KEY, 'tenant-token');
  expect((await invoke()).outcome).toBe('succeeded');
  expect((await invoke('other.example')).outcome).toBe('not-dispatched');
  await service.mcpCredential(admin, 'rotate', INSTALLATION, 1, '88888888-8888-4888-8888-888888888888', 'rotated-token');
  await invoke();
  await service.mcpCredential(admin, 'disconnect', INSTALLATION, 2, '99999999-9999-4999-8999-999999999990');
  expect((await invoke()).outcome).toBe('not-dispatched');
  expect(bearers).toEqual(['Bearer tenant-token', 'Bearer rotated-token']);
});
