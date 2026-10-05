import { expect, test } from 'vitest';
import { digest } from '../../contracts/src/index.js';
import type { ExecutionContext } from '../../identity/src/index.js';
import type { StudioStore, StudioStoredDraft } from '../../lifecycle/src/studio-sql.js';
import type { StudioDraft } from '../../lifecycle/src/studio.js';
import type { CapabilityGrant, Installation } from './service.js';
import { WorkflowService } from './service.js';
import type { GraphDraft } from './graph.js';
import type { WorkflowRecord } from './sql.js';
import { MemoryRecords, TENANT, asStore, contextFor, shape } from './worker-harness.test-support.js';

const GITHUB = '33333333-3333-4333-8333-333333333333';
const STATUS = '66666666-6666-4666-8666-666666666666';
const DRAFT = '77777777-7777-4777-8777-777777777777';
const KEY = '88888888-8888-4888-8888-888888888888';
const str = { type: 'string' as const };
const cap = (name: string, risk: 'R1' | 'R2' | 'R3', properties: Record<string, { type: 'string' | 'number' }>, extra: Record<string, unknown> = {}) => ({ name, risk, inputSchema: shape(properties), outputSchema: shape({ result: { type: 'object' } }), ...extra });
const githubCaps = [
  cap('pull_request_read', 'R1', { owner: str, repo: str, pullNumber: { type: 'number' } }),
  cap('merge_pull_request', 'R3', { owner: str, repo: str, pullNumber: { type: 'number' }, expectedHeadSha: str, merge_method: str, commit_title: str, commit_message: str }),
  cap('issue_write', 'R2', { method: str, owner: str, repo: str, title: str, body: str }),
];
const statusCaps = [cap('create_commit_status', 'R2', { owner: str, repo: str, sha: str, outcome: str, run: str }, { targetFields: ['owner', 'repo', 'sha'] })];
const installation = (id: string, capabilities: readonly unknown[]): Installation => ({ id, route: 'public', endpoint: 'https://mcp.example/mcp', health: 'healthy', manifest: { digest: `digest-${id}`, version: '1', certified: true, capabilities } as Installation['manifest'] });

class Studio implements StudioStore {
  readonly drafts = new Map<string, StudioStoredDraft<StudioDraft | GraphDraft>>();
  readonly receipts = new Map<string, string>();
  async create(context: ExecutionContext, id: string, draft: StudioDraft | GraphDraft, key?: string) {
    const valueDigest = await digest(draft);
    if (key && this.receipts.get(key) !== undefined) { if (this.receipts.get(key) !== valueDigest) throw Object.assign(new Error('CONFLICT'), { code: 'CONFLICT' }); return this.get(context, id); }
    const saved = { id, tenantId: String(context.tenantId), revision: 1, state: 'draft', digest: valueDigest, author: context.userId, draft, createdAt: '2026-01-01T00:00:00.000Z' } as StudioStoredDraft<StudioDraft | GraphDraft>;
    this.drafts.set(id, saved); if (key) this.receipts.set(key, valueDigest);
    return saved;
  }
  get(_context: ExecutionContext, id: string) { const saved = this.drafts.get(id); return saved ? Promise.resolve(saved) : Promise.reject(Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' })); }
  list() { return Promise.resolve([...this.drafts.values()]); }
  revisions() { return Promise.resolve([]); }
  save(): Promise<never> { return Promise.reject(new Error('unused')); }
  async appendRun() {}
  async appendReview() {}
  rememberCommand(_tenant: string, _key: string, _digest: string, receipt: never) { return Promise.resolve(receipt); }
}

const setup = (options: { github?: readonly unknown[]; ready?: boolean } = {}) => {
  const records = new MemoryRecords(); records.profiles.set('admin-1', ['admin', 'editor']); records.profiles.set('editor-1', ['editor']);
  for (const [id, caps] of [[GITHUB, options.github ?? githubCaps], [STATUS, statusCaps]] as const) records.records.set(`${TENANT}:installation:${id}`, { id, kind: 'installation', version: 1, state: 'healthy', data: installation(id, caps) });
  const studio = new Studio();
  const service = new WorkflowService(studio, asStore(records), undefined, [], ['openrouter'], () => options.ready ?? true);
  return { records, studio, service };
};
const grantsOf = (records: MemoryRecords) => [...records.records.values()].filter((item) => item.kind === 'grant') as WorkflowRecord<CapabilityGrant>[];
const admin = contextFor('admin-1');

test('creates the draft with a grant for every connector node and a passing check', async () => {
  const { records, studio, service } = setup();
  const result = await service.instantiatePrGate(admin, DRAFT, GITHUB, STATUS, KEY);
  expect(result).toEqual({ created: true, issues: [] });
  expect(studio.drafts.has(DRAFT)).toBe(true);
  const grants = grantsOf(records);
  expect(grants.map((item) => `${item.data.nodeId}:${item.data.capability}`).sort()).toEqual(['issue:issue_write', 'merge:merge_pull_request', 'status:create_commit_status', 't_diff:pull_request_read']);
  const graph = studio.drafts.get(DRAFT)?.draft as GraphDraft;
  for (const grant of grants) expect(graph.nodes.find((node) => node.id === grant.data.nodeId)?.config['grantId']).toBe(grant.id);
  expect((await service.check(admin, DRAFT)).issues).toEqual([]);
});

test('a missing capability fails with a clear message and creates nothing', async () => {
  const { records, studio, service } = setup({ github: githubCaps.filter((item) => item.name !== 'issue_write') });
  const result = await service.instantiatePrGate(admin, DRAFT, GITHUB, STATUS, KEY);
  expect(result.created).toBe(false);
  expect(result.issues.map((issue) => issue.message)).toEqual([expect.stringContaining('issue_write')]);
  expect(studio.drafts.size).toBe(0);
  expect(grantsOf(records)).toHaveLength(0);
});

test('a connector without a usable token is reported and nothing is created', async () => {
  const { studio, service } = setup({ ready: false });
  const result = await service.instantiatePrGate(admin, DRAFT, GITHUB, STATUS, KEY);
  expect(result.created).toBe(false);
  expect(result.issues).toHaveLength(2);
  expect(studio.drafts.size).toBe(0);
});

test('an unknown installation is reported, an invalid id is invalid and a non-administrator is denied', async () => {
  const { service } = setup();
  expect((await service.instantiatePrGate(admin, DRAFT, '99999999-9999-4999-8999-999999999999', STATUS, KEY)).issues).toHaveLength(1);
  await expect(service.instantiatePrGate(admin, 'nope', GITHUB, STATUS, KEY)).rejects.toMatchObject({ code: 'INVALID' });
  await expect(service.instantiatePrGate(contextFor('editor-1'), DRAFT, GITHUB, STATUS, KEY)).rejects.toMatchObject({ code: 'DENIED' });
});

test('replaying the same command creates no duplicate draft or grants', async () => {
  const { records, service } = setup();
  await service.instantiatePrGate(admin, DRAFT, GITHUB, STATUS, KEY);
  expect(await service.instantiatePrGate(admin, DRAFT, GITHUB, STATUS, KEY)).toEqual({ created: true, issues: [] });
  expect(grantsOf(records)).toHaveLength(4);
});
