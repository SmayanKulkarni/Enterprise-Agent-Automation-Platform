import { expect, test } from 'vitest';
import { compileGraph, validateGraph, type CapabilityPin, type JsonSchema } from './graph.js';
import { PR_GATE_NODE_GRANTS, buildPrGateGraph, prGateIssues, type PrGateInstallation } from './pr-gate-template.js';
import { shape } from './worker-harness.test-support.js';

const str = { type: 'string' as const };
const GITHUB = '33333333-3333-4333-8333-333333333333';
const STATUS = '66666666-6666-4666-8666-666666666666';
const capability = (name: string, risk: 'R1' | 'R2' | 'R3', inputSchema: JsonSchema, extra: Record<string, unknown> = {}) => ({ name, risk, inputSchema, outputSchema: shape({ result: { type: 'object' } }), ...extra });
const github = (overrides: Record<string, ReturnType<typeof capability> | null> = {}): PrGateInstallation => {
  const all: Record<string, ReturnType<typeof capability> | null> = {
    pull_request_read: capability('pull_request_read', 'R1', shape({ owner: str, repo: str, pullNumber: { type: 'number' } })),
    merge_pull_request: capability('merge_pull_request', 'R3', shape({ owner: str, repo: str, pullNumber: { type: 'number' }, expectedHeadSha: str, merge_method: str, commit_title: str, commit_message: str })),
    issue_write: capability('issue_write', 'R2', shape({ method: str, owner: str, repo: str, title: str, body: str })),
    ...overrides,
  };
  return { id: GITHUB, state: 'healthy', manifest: { digest: 'github-digest', certified: true, version: '1', capabilities: Object.values(all).flatMap((item) => item === null ? [] : [item]) } };
};
const status = (risk: 'R1' | 'R2' | 'R3' = 'R2'): PrGateInstallation => ({ id: STATUS, state: 'healthy', manifest: { digest: 'status-digest', certified: true, version: '1', capabilities: [capability('create_commit_status', risk, shape({ owner: str, repo: str, sha: str, outcome: str, run: str }), { targetFields: ['owner', 'repo', 'sha'] })] } });
const messages = (a: PrGateInstallation | undefined, b: PrGateInstallation | undefined) => prGateIssues(a, b).map((issue) => issue.message);

test('a complete pair of installations has no issues', () => {
  expect(prGateIssues(github(), status())).toEqual([]);
});

test('a missing capability is named in plain words', () => {
  expect(messages(github({ issue_write: null, merge_pull_request: null }), status())).toEqual([expect.stringContaining('merge_pull_request'), expect.stringContaining('issue_write')]);
  expect(messages(github(), { ...status(), manifest: { ...status().manifest, capabilities: [] } })).toEqual([expect.stringContaining('create_commit_status')]);
});

test('an unready or uncertified installation is reported once', () => {
  expect(messages({ ...github(), state: 'offline' }, status())).toEqual([expect.stringContaining('GitHub connector')]);
  expect(messages(github(), { ...status(), manifest: { ...status().manifest, certified: false } })).toEqual([expect.stringContaining('commit status connector')]);
  expect(messages(undefined, undefined)).toHaveLength(2);
});

test('risks that would skip approval or block the finalizer are reported with the fix', () => {
  expect(messages(github({ pull_request_read: capability('pull_request_read', 'R3', shape({ owner: str, repo: str, pullNumber: { type: 'number' } })) }), status())).toEqual([expect.stringMatching(/pull_request_read.*R1/u)]);
  expect(messages(github({ merge_pull_request: capability('merge_pull_request', 'R1', shape({ owner: str, repo: str, pullNumber: { type: 'number' } })) }), status())).toEqual([expect.stringMatching(/merge_pull_request.*R2 or R3/u)]);
  expect(messages(github(), status('R3'))).toEqual([expect.stringMatching(/create_commit_status.*R1 or R2/u)]);
});

test('an argument the template cannot fill is reported', () => {
  expect(messages(github({ issue_write: capability('issue_write', 'R2', shape({ owner: str, repo: str, title: str, body: str, labels: { type: 'array' } })) }), status())).toEqual([expect.stringMatching(/issue_write.*labels/u)]);
  expect(messages(github({ merge_pull_request: capability('merge_pull_request', 'R3', shape({ owner: str, repo: str })) }), status())).toEqual([expect.stringMatching(/merge_pull_request.*pullNumber/u)]);
});

const grants = Object.fromEntries(PR_GATE_NODE_GRANTS.map((name, index) => [name, `4444444${String(index)}-4444-4444-8444-444444444444`]));
const pins = (installations: { github: PrGateInstallation; status: PrGateInstallation }): CapabilityPin[] => PR_GATE_NODE_GRANTS.map((node) => {
  const source = node === 'status' ? installations.status : installations.github;
  const name = { t_diff: 'pull_request_read', merge: 'merge_pull_request', issue: 'issue_write', status: 'create_commit_status' }[node];
  const item = source.manifest.capabilities.find((entry) => entry.name === name);
  if (!item) throw new Error(`no ${name}`);
  return { nodeId: node, installationId: source.id, capability: name, manifestDigest: source.manifest.digest, grantId: grants[node] ?? '', risk: item.risk, inputSchema: item.inputSchema, outputSchema: item.outputSchema, ...(item.targetFields ? { targetFields: item.targetFields } : {}) };
});
const build = (installations = { github: github(), status: status() }) => buildPrGateGraph({ ...installations, grants });

test('the graph covers trigger, reviewer, condition, approvals, merge, issue and the status finalizer', () => {
  const graph = build();
  expect(graph.nodes.map((node) => `${node.id}:${node.kind}`).sort()).toEqual(['approve_issue:approval', 'approve_merge:approval', 'end_merged:end', 'end_returned:end', 'gate_accept:condition', 'intake:trigger', 'issue:mcp', 'merge:mcp', 'reviewer:agent', 'status:mcp', 't_diff:mcp']);
  expect(graph.edges.find((edge) => edge.role === 'finalizer')).toMatchObject({ from: 'intake', to: 'status' });
  expect(graph.edges.filter((edge) => edge.role === 'tool').map((edge) => edge.to)).toEqual(['t_diff']);
});

test('the trigger accepts signed GitHub pull request deliveries only', () => {
  const trigger = build().nodes.find((node) => node.id === 'intake');
  expect(trigger?.config).toMatchObject({ mode: 'webhook', source: 'github', when: { event: ['pull_request'], action: ['opened', 'synchronize', 'reopened'] }, subjectKey: ['owner', 'repo', 'pullNumber'], subjectVersion: 'headSha' });
});

test('every connector node is bound to its installation, digest and pre-allocated grant', () => {
  const graph = build();
  for (const [id, installation] of [['t_diff', GITHUB], ['merge', GITHUB], ['issue', GITHUB], ['status', STATUS]] as const) expect(graph.nodes.find((node) => node.id === id)?.config).toMatchObject({ installationId: installation, grantId: grants[id] });
});

test('merge and issue stay behind human approval that discloses the pull request', () => {
  const graph = build();
  for (const [approval, effect] of [['approve_merge', 'merge'], ['approve_issue', 'issue']] as const) {
    expect(graph.edges.some((edge) => edge.from === approval && edge.to === effect)).toBe(true);
    expect((graph.nodes.find((node) => node.id === approval)?.config['disclose'] as string[])).toEqual(expect.arrayContaining(['repo']));
  }
  expect(graph.nodes.find((node) => node.id === 'approve_merge')?.config['disclose']).toEqual(expect.arrayContaining(['pullNumber']));
});

test('the produced draft passes the same graph check and compiles', async () => {
  const installations = { github: github(), status: status() };
  const graph = build(installations);
  expect(validateGraph(graph, pins(installations))).toEqual([]);
  await expect(compileGraph('99999999-9999-4999-8999-999999999999', 1, graph, pins(installations))).resolves.toHaveProperty('digest');
});

test('only arguments the connector declares are mapped, so a lean schema still passes the check', () => {
  const lean = github({ merge_pull_request: capability('merge_pull_request', 'R3', shape({ owner: str, repo: str, pullNumber: { type: 'number' } })), issue_write: capability('issue_write', 'R2', shape({ owner: str, repo: str, title: str, body: str })) });
  const installations = { github: lean, status: status() };
  expect(prGateIssues(lean, installations.status)).toEqual([]);
  const graph = build(installations);
  expect(validateGraph(graph, pins(installations))).toEqual([]);
  expect(graph.nodes.find((node) => node.id === 'merge')?.config['arguments']).toEqual({ owner: '$input.owner', repo: '$input.repo', pullNumber: '$input.pullNumber' });
});
