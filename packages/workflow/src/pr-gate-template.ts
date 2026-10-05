import type { GraphDraft, GraphEdge, GraphIssue, GraphNode, JsonSchema } from './graph.js';
import type { CapabilityManifest } from './service.js';

export interface PrGateInstallation { id: string; state: string; manifest: CapabilityManifest; }
export type PrGateNode = 't_diff' | 'merge' | 'issue' | 'status';
export const PR_GATE_NODE_GRANTS: readonly PrGateNode[] = ['t_diff', 'merge', 'issue', 'status'];
export const PR_GATE_DEFAULT_MODEL = 'deepseek/deepseek-v4-flash-0731';

type Risk = 'R1' | 'R2' | 'R3';
interface Requirement { node: PrGateNode; capability: string; side: 'github' | 'status'; risks: readonly Risk[]; riskText: string; mustHave: readonly string[]; desired: Readonly<Record<string, unknown>>; }

const ISSUE_TITLE = '$node.reviewer.issueTitle';
const REQUIREMENTS: readonly Requirement[] = [
  { node: 't_diff', capability: 'pull_request_read', side: 'github', risks: ['R1'], riskText: 'R1', mustHave: [], desired: {} },
  { node: 'merge', capability: 'merge_pull_request', side: 'github', risks: ['R2', 'R3'], riskText: 'R2 or R3', mustHave: ['owner', 'repo', 'pullNumber'], desired: { owner: '$input.owner', repo: '$input.repo', pullNumber: '$input.pullNumber', expectedHeadSha: '$input.headSha', merge_method: 'squash', commit_title: '$node.reviewer.mergeTitle', commit_message: '$node.reviewer.summary' } },
  { node: 'issue', capability: 'issue_write', side: 'github', risks: ['R2', 'R3'], riskText: 'R2 or R3', mustHave: ['owner', 'repo', 'title', 'body'], desired: { method: 'create', owner: '$input.owner', repo: '$input.repo', title: ISSUE_TITLE, body: '$node.reviewer.issueBody' } },
  { node: 'status', capability: 'create_commit_status', side: 'status', risks: ['R1', 'R2'], riskText: 'R1 or R2', mustHave: ['owner', 'repo', 'sha', 'outcome', 'run'], desired: { owner: '$input.owner', repo: '$input.repo', sha: '$input.headSha', outcome: '$run.outcome', run: '$run.id' } },
];
const SIDE_NAME = { github: 'GitHub connector', status: 'commit status connector' } as const;
const DISCLOSE = { merge: ['repo', 'pullNumber', 'commit_title', 'commit_message'], issue: ['repo', 'title', 'body'] } as const;

const policy = (milliseconds: number, effects = 0) => ({ milliseconds, attempts: 1, tokens: 0, cost: 0, toolRounds: 0, effects });
const issue = (path: string, message: string): GraphIssue => ({ path, code: 'PR_GATE_TEMPLATE', message });
const capabilityOf = (installation: PrGateInstallation | undefined, name: string) => installation?.manifest.capabilities.find((item) => item.name === name);
const argumentsFor = (schema: JsonSchema, desired: Readonly<Record<string, unknown>>): Record<string, unknown> => Object.fromEntries(Object.entries(desired).filter(([key]) => key in schema.properties));

export function prGateIssues(github: PrGateInstallation | undefined, status: PrGateInstallation | undefined): GraphIssue[] {
  const installations = { github, status };
  const issues: GraphIssue[] = [];
  for (const side of ['github', 'status'] as const) {
    const installation = installations[side];
    if (!installation || installation.state !== 'healthy' || !installation.manifest.certified) issues.push(issue(`/installations/${side}`, `Choose a healthy certified ${SIDE_NAME[side]}.`));
  }
  for (const requirement of REQUIREMENTS) {
    const installation = installations[requirement.side];
    if (!installation || installation.state !== 'healthy' || !installation.manifest.certified) continue;
    const path = `/installations/${requirement.side}/${requirement.capability}`;
    const found = capabilityOf(installation, requirement.capability);
    if (!found) { issues.push(issue(path, `The ${SIDE_NAME[requirement.side]} is missing ${requirement.capability}. Discover its tools and certify it.`)); continue; }
    if (!requirement.risks.includes(found.risk)) issues.push(issue(path, `${requirement.capability} is ${found.risk}; it must be ${requirement.riskText}. Change its risk when certifying.`));
    const missing = requirement.mustHave.filter((name) => !(name in found.inputSchema.properties));
    if (missing.length) issues.push(issue(path, `${requirement.capability} has no ${missing.join(', ')} argument, which the template needs.`));
    const filled = argumentsFor(found.inputSchema, requirement.desired);
    const unfilled = found.inputSchema.required.filter((name) => !(name in filled));
    if (requirement.node !== 't_diff' && unfilled.length) issues.push(issue(path, `${requirement.capability} requires ${unfilled.join(', ')}, which the template cannot fill. Fix a value for it when certifying.`));
  }
  return issues;
}

const INSTRUCTIONS = `You are a code gate for a GitHub repository. Review the pull request and give a SUGGESTION; a human administrator makes the final decision.
The run input has "kind" ("pull_request"), "owner", "repo", "pullNumber", "headSha", "title" and "author".
Call pull_request_read to read the diff of the pull request with owner, repo and pullNumber (pass method "get_diff" when the tool asks for a method). Call one tool at a time.
Judge only what the diff shows. Block (accept=false) on any of: hardcoded secrets or keys, injection (SQL, command, eval), weakened or removed validation, deleted or weakened tests without replacement, comparison or auth bugs, or an obvious logic regression. Accept (accept=true) only when you find no blocking issue; minor style notes do not block.
Finish with the final JSON:
- accept: boolean.
- riskLevel: "low", "medium" or "high".
- summary: two or three sentences for the human decider that name the concrete reason for your suggestion.
- issueTitle: "Gate: return PR #<pullNumber> - <short reason>".
- issueBody: markdown with the heading "Automated gate suggestion", the verdict, the PR number, then one bullet per finding as "file:line - problem - fix". When accepting write "No blocking findings" plus any minor notes.
- mergeTitle: a squash commit title of at most 72 characters.
Never invent files or lines that are not in the diff.`;

const schema = (properties: JsonSchema['properties'], required: string[]): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false });
const text = { type: 'string' } as const;

export interface PrGateBuild { github: PrGateInstallation; status: PrGateInstallation; grants: Readonly<Record<string, string>>; model?: string; }

export function buildPrGateGraph({ github, status, grants, model = PR_GATE_DEFAULT_MODEL }: PrGateBuild): GraphDraft {
  const node = (id: string, kind: string, title: string, detail: string, x: number, y: number, config: Record<string, unknown>, instructions = ''): GraphNode => ({ id, kind, title, detail, x, y, instructions, config });
  const bound = (requirement: Requirement, x: number, y: number, title: string, detail: string, extra: Record<string, unknown>): GraphNode => {
    const installation = requirement.side === 'github' ? github : status;
    const found = capabilityOf(installation, requirement.capability);
    if (!found) throw new Error('PR_GATE_CAPABILITY_MISSING');
    const args = requirement.node === 't_diff' ? {} : argumentsFor(found.inputSchema, requirement.desired);
    return node(requirement.node, 'mcp', title, detail, x, y, { installationId: installation.id, capability: requirement.capability, manifestDigest: installation.manifest.digest, grantId: grants[requirement.node] ?? '', target: 'github.com', arguments: args, policy: policy(60000, 1), ...extra });
  };
  const [diff, merge, issueWrite, commitStatus] = REQUIREMENTS as readonly [Requirement, Requirement, Requirement, Requirement];
  const disclose = (name: 'merge' | 'issue', requirement: Requirement): string[] => DISCLOSE[name].filter((key) => key in argumentsFor(capabilityOf(github, requirement.capability)?.inputSchema ?? schema({}, []), requirement.desired));
  const nodes: GraphNode[] = [
    node('intake', 'trigger', 'GitHub pull request', 'signed GitHub webhook', 40, 200, {
      mode: 'webhook', source: 'github', when: { event: ['pull_request'], action: ['opened', 'synchronize', 'reopened'] },
      subjectKey: ['owner', 'repo', 'pullNumber'], subjectVersion: 'headSha',
      inputMap: { kind: '$event', owner: '$body.repository.owner.login', repo: '$body.repository.name', pullNumber: '$body.pull_request.number', headSha: '$body.pull_request.head.sha', title: '$body.pull_request.title', author: '$body.pull_request.user.login' },
      inputSchema: schema({ kind: text, owner: text, repo: text, pullNumber: { type: 'number' }, headSha: text, title: text, author: text }, ['kind', 'owner', 'repo', 'pullNumber', 'headSha', 'title', 'author']),
    }),
    node('reviewer', 'agent', 'Code reviewer', `openrouter ${model}`, 300, 200, {
      provider: 'openrouter', model, promptVersion: 'v1', openRouterOptIn: true, allowedCapabilities: ['merge_pull_request', 'issue_write'],
      responseSchema: schema({ accept: { type: 'boolean' }, riskLevel: text, summary: text, issueTitle: text, issueBody: text, mergeTitle: text }, ['accept', 'riskLevel', 'summary', 'issueTitle', 'issueBody', 'mergeTitle']),
      policy: { milliseconds: 300000, attempts: 2, tokens: 60000, cost: 0.5, toolRounds: 6, effects: 4 },
    }, INSTRUCTIONS),
    bound(diff, 760, 80, 'Read PR diff', 'pull_request_read (R1)', {}),
    node('gate_accept', 'condition', 'Suggest accept?', 'accept is true', 1000, 200, { source: 'reviewer', field: 'accept', equals: true }),
    node('approve_merge', 'approval', 'Human: merge?', 'admin confirms the merge', 1220, 80, { timeoutMs: 86400000, disclose: disclose('merge', merge) }),
    bound(merge, 1440, 80, 'Squash-merge PR', 'merge_pull_request', {}),
    node('end_merged', 'end', 'Merged', 'PR merged after human approval', 1660, 80, { outcome: 'accepted' }),
    node('approve_issue', 'approval', 'Human: return?', 'admin confirms returning the change', 1220, 320, { timeoutMs: 86400000, disclose: disclose('issue', issueWrite) }),
    bound(issueWrite, 1440, 320, 'Raise return issue', 'issue_write', {}),
    node('end_returned', 'end', 'Returned', 'issue raised after human approval', 1660, 320, { outcome: 'returned' }),
    bound(commitStatus, 300, 420, 'Publish commit status', 'create_commit_status', {}),
  ];
  const edge = (id: string, from: string, to: string, extra: Partial<GraphEdge> = {}): GraphEdge => ({ id, from, to, ...extra });
  const edges: GraphEdge[] = [
    edge('e1', 'intake', 'reviewer'), edge('e2', 'reviewer', 'gate_accept'),
    edge('e3', 'gate_accept', 'approve_merge', { branch: 'true' }), edge('e4', 'gate_accept', 'approve_issue', { branch: 'false' }),
    edge('e5', 'approve_merge', 'merge'), edge('e6', 'merge', 'end_merged'),
    edge('e7', 'approve_issue', 'issue'), edge('e8', 'issue', 'end_returned'),
    edge('tool_t_diff', 'reviewer', 't_diff', { role: 'tool' }), edge('finalizer_status', 'intake', 'status', { role: 'finalizer' }),
  ];
  return { kind: 'graph-v1', nodes, edges };
}
