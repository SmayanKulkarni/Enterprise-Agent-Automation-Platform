import { expect, test, vi } from 'vitest';
import { STATUS_CONTEXT, certifiedStatusInstallation, statusConnectorEndpoint, commitStatusRequest, handleStatusMcp, statusFor } from './commit-status-connector.js';
import { validateGraph, validateSchema, type CapabilityPin, type GraphDraft } from './graph.js';
import { digest } from '../../contracts/src/index.js';

const RUN = '11111111-2222-4333-8444-555555555555';
const args = { owner: 'acme', repo: 'widgets', sha: 'abc1234', outcome: 'accepted', run: RUN };
const body = (message: unknown) => new TextEncoder().encode(JSON.stringify(message));
const call = (overrides: Record<string, unknown> = {}) => body({ jsonrpc: '2.0', id: 'r1', method: 'tools/call', params: { name: 'create_commit_status', arguments: { ...args, ...overrides } } });
const bearer = 'Bearer github-token';

test.each([['accepted', 'success'], ['completed', 'success'], ['returned', 'failure'], ['rejected', 'failure'], ['failed', 'error'], ['expired', 'error'], ['cancelled', 'error'], ['superseded', 'error'], ['anything-else', 'error']])('outcome %s publishes %s and never pending', (outcome, state) => {
  expect(statusFor(outcome)).toBe(state);
  expect(statusFor(outcome)).not.toBe('pending');
});

test('builds the GitHub status request for the gate context', () => {
  const request = commitStatusRequest({ ...args, targetBase: 'https://app.example' });
  expect(request.url).toBe('https://api.github.com/repos/acme/widgets/statuses/abc1234');
  expect(request.body).toMatchObject({ state: 'success', context: STATUS_CONTEXT, target_url: `https://app.example/#run-${RUN}` });
  expect(request.body.description.length).toBeLessThanOrEqual(140);
  expect(STATUS_CONTEXT).toBe('workflow/pr-gate');
});

test.each([['owner', '../x'], ['repo', 'a b'], ['sha', 'zzz'], ['run', 'not-a-run'], ['outcome', 7]])('refuses an invalid %s', (field, value) => {
  expect(() => commitStatusRequest({ ...args, [field]: value })).toThrow();
});

test('rejects a request with no bearer, a wrong method or an oversize body before any outbound call', async () => {
  const fetcher = vi.fn();
  expect((await handleStatusMcp({ method: 'POST', body: call() }, { fetch: fetcher })).status).toBe(401);
  expect((await handleStatusMcp({ method: 'GET', authorization: bearer, body: call() }, { fetch: fetcher })).status).toBe(405);
  expect((await handleStatusMcp({ method: 'POST', authorization: bearer, body: new Uint8Array(16385) }, { fetch: fetcher })).status).toBe(413);
  expect((await handleStatusMcp({ method: 'POST', authorization: bearer, body: new TextEncoder().encode('{') }, { fetch: fetcher })).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});

test('lists its single tool and answers initialize', async () => {
  const listed = await handleStatusMcp({ method: 'POST', authorization: bearer, body: body({ jsonrpc: '2.0', id: 'l', method: 'tools/list' }) });
  expect(listed.body).toMatchObject({ result: { tools: [{ name: 'create_commit_status' }] } });
  expect(await handleStatusMcp({ method: 'POST', authorization: bearer, body: body({ jsonrpc: '2.0', id: 'i', method: 'initialize' }) })).toMatchObject({ status: 200, body: { result: { serverInfo: { name: 'commit-status-mcp' } } } });
});

test('posts the status to GitHub with the caller token and returns the state', async () => {
  const fetcher = vi.fn(() => Promise.resolve(new Response('{}', { status: 201 })));
  const reply = await handleStatusMcp({ method: 'POST', authorization: bearer, body: call() }, { fetch: fetcher });
  expect(reply).toMatchObject({ status: 200, body: { id: 'r1', result: { structuredContent: { state: 'success' } } } });
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
  expect(url).toBe('https://api.github.com/repos/acme/widgets/statuses/abc1234');
  expect(init.headers['authorization']).toBe('Bearer github-token');
  expect(JSON.parse(init.body)).toMatchObject({ state: 'success', context: 'workflow/pr-gate' });
});

test('a GitHub error or invalid arguments become an error result that never carries the token', async () => {
  const refused = await handleStatusMcp({ method: 'POST', authorization: bearer, body: call() }, { fetch: (() => Promise.resolve(new Response('no', { status: 403 }))) });
  expect(refused.body).toMatchObject({ result: { isError: true } });
  const invalid = await handleStatusMcp({ method: 'POST', authorization: bearer, body: call({ owner: '../x' }) }, { fetch: vi.fn() });
  expect(invalid.body).toMatchObject({ result: { isError: true } });
  expect(JSON.stringify([refused, invalid])).not.toContain('github-token');
  expect((await handleStatusMcp({ method: 'POST', authorization: bearer, body: body({ jsonrpc: '2.0', id: 'x', method: 'nope' }) })).body).toMatchObject({ error: { code: -32601 } });
});

test('the hosted installation is a certified public R2 capability limited to input, outcome and run', async () => {
  const installation = await certifiedStatusInstallation('https://app.example/api/connectors/github-status');
  const [capability] = installation.manifest.capabilities as [(typeof installation.manifest.capabilities)[number]];
  expect(installation).toMatchObject({ route: 'public', health: 'healthy', endpoint: 'https://app.example/api/connectors/github-status', manifest: { certified: true } });
  expect(capability).toMatchObject({ name: 'create_commit_status', risk: 'R2', targetFields: ['owner', 'repo', 'sha'] });
  expect(Object.keys(capability.inputSchema.properties)).toEqual(['owner', 'repo', 'sha', 'outcome', 'run']);
  expect(validateSchema(capability.inputSchema) && validateSchema(capability.outputSchema)).toBe(true);
  expect(installation.manifest.digest).toBe(await digest({ version: installation.manifest.version, capabilities: installation.manifest.capabilities }));
});

test('the hosted capability passes the finalizer check as the PR gate wires it', async () => {
  const { manifest } = await certifiedStatusInstallation('https://app.example/api/connectors/github-status');
  const capability = manifest.capabilities.find((item) => item.name === 'create_commit_status');
  if (!capability) throw new Error('capability missing');
  const pin: CapabilityPin = { nodeId: 'status', installationId: '33333333-3333-4333-8333-333333333333', capability: capability.name, manifestDigest: manifest.digest, grantId: '44444444-4444-4444-8444-444444444444', risk: capability.risk, inputSchema: capability.inputSchema, outputSchema: capability.outputSchema, ...(capability.targetFields ? { targetFields: capability.targetFields } : {}) };
  const node = (id: string, kind: string, config: Record<string, unknown>) => ({ id, kind, title: id, detail: '', x: 0, y: 0, instructions: '', config });
  const input = { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, head: { type: 'string' } }, required: ['owner', 'repo', 'head'], additionalProperties: false };
  const draft = { kind: 'graph-v1', nodes: [
    node('start', 'trigger', { mode: 'manual', inputSchema: input }),
    node('status', 'mcp', { installationId: pin.installationId, capability: pin.capability, manifestDigest: pin.manifestDigest, grantId: pin.grantId, target: 'repo', arguments: { owner: '$input.owner', repo: '$input.repo', sha: '$input.head', outcome: '$run.outcome', run: '$run.id' }, policy: { milliseconds: 60000, attempts: 1, tokens: 1000, cost: 1, toolRounds: 2, effects: 2 } }),
    node('end', 'end', {}),
  ], edges: [{ id: 'a', from: 'start', to: 'end' }, { id: 'f', from: 'start', to: 'status', role: 'finalizer' }] } as GraphDraft;
  expect(validateGraph(draft, [pin]).map((issue) => issue.code)).toEqual([]);
});

test('the endpoint is the deployment origin plus the connector route', () => {
  expect(statusConnectorEndpoint('https://app.example')).toBe('https://app.example/api/connectors/github-status');
  expect(statusConnectorEndpoint('https://app.example//')).toBe('https://app.example/api/connectors/github-status');
});
