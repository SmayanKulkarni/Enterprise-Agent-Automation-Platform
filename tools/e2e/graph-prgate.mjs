const MODEL = 'deepseek/deepseek-v4-flash-0731';
const schema = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const policy = (milliseconds, effects = 0) => ({ milliseconds, attempts: 1, tokens: 0, cost: 0, toolRounds: 0, effects });
const str = { type: 'string' };

export const TOOLS = [
  { id: 't_diff', capability: 'pull_request_get_diff', title: 'Read PR diff', y: 80 },
  { id: 't_commit', capability: 'get_commit', title: 'Read commit', y: 200 },
];
export const STATUS_CAPABILITY = 'create_commit_status';
export const EFFECTS = [
  { id: 'merge', capability: 'merge_pull_request' },
  { id: 'issue', capability: 'issue_write' },
];

const INSTRUCTIONS = `You are a code gate for a GitHub repository. Review the change and give a SUGGESTION; a human administrator makes the final decision.
The run input has "kind" ("pull_request" or "push"), "owner", "repo", "pullNumber" (0 for a push), "headSha", "title" and "author".
Work one tool call at a time:
- kind "pull_request": call pull_request_get_diff with owner, repo and pullNumber.
- kind "push": call get_commit with owner, repo, sha = headSha and detail "full_patch".
Judge only what the diff shows. Block (accept=false) on any of: hardcoded secrets or keys, injection (SQL, command, eval), weakened or removed validation, deleted or weakened tests without replacement, comparison or auth bugs, or an obvious logic regression. Accept (accept=true) only when you find no blocking issue; minor style notes do not block.
Finish with the final JSON:
- accept: boolean.
- riskLevel: "low", "medium" or "high".
- summary: two or three sentences for the human decider that name the concrete reason for your suggestion.
- issueTitle: for a PR "Gate: return PR #<pullNumber> - <short reason>", for a push "Gate: return commit <first 7 of headSha> - <short reason>".
- issueBody: markdown with the heading "Automated gate suggestion", the verdict, the PR number or commit sha, then one bullet per finding as "file:line - problem - fix". When accepting write "No blocking findings" plus any minor notes.
- mergeTitle: a squash commit title of at most 72 characters.
Never invent files or lines that are not in the diff.`;

export function buildGraph({ installation, grants, status }) {
  const node = (id, kind, title, detail, x, y, config, instructions = '') => ({ id, kind, title, detail, x, y, instructions, config });
  const pin = (capability) => ({ installationId: installation.id, capability, manifestDigest: installation.digest });
  const tool = (item) => node(item.id, 'mcp', item.title, item.capability, 760, item.y, { ...pin(item.capability), grantId: grants[item.id], target: 'github.com', arguments: {}, policy: policy(60000, 1) });
  const nodes = [
    node('intake', 'trigger', 'PR or push event', 'signed webhook', 40, 200, { mode: 'webhook', subjectKey: ['owner', 'repo', 'pullNumber'], subjectVersion: 'headSha', inputSchema: schema({ kind: str, owner: str, repo: str, pullNumber: { type: 'number' }, headSha: str, title: str, author: str }, ['kind', 'owner', 'repo', 'pullNumber', 'headSha', 'title', 'author']) }),
    node('reviewer', 'agent', 'Code reviewer', `openrouter ${MODEL}`, 300, 200, {
      provider: 'openrouter', model: MODEL, promptVersion: 'v1', openRouterOptIn: true, allowedCapabilities: ['merge_pull_request', 'issue_write'],
      responseSchema: schema({ accept: { type: 'boolean' }, riskLevel: str, summary: str, issueTitle: str, issueBody: str, mergeTitle: str }, ['accept', 'riskLevel', 'summary', 'issueTitle', 'issueBody', 'mergeTitle']),
      policy: { milliseconds: 300000, attempts: 2, tokens: 60000, cost: 0.5, toolRounds: 6, effects: 4 },
    }, INSTRUCTIONS),
    ...TOOLS.map(tool),
    node('gate_accept', 'condition', 'Suggest accept?', 'accept is true', 1000, 200, { source: 'reviewer', field: 'accept', equals: true }),
    node('gate_kind', 'condition', 'Is it a PR?', 'kind is pull_request', 1220, 120, { source: 'input', field: 'kind', equals: 'pull_request' }),
    node('approve_merge', 'approval', 'Human: merge?', 'admin confirms the merge', 1440, 60, { timeoutMs: 86400000, disclose: ['repo', 'pullNumber', 'commit_title', 'commit_message'] }),
    node('merge', 'mcp', 'Squash-merge PR', 'merge_pull_request (R3)', 1660, 60, { ...pin('merge_pull_request'), grantId: grants.merge, target: 'github.com', arguments: { owner: '$input.owner', repo: '$input.repo', pullNumber: '$input.pullNumber', expectedHeadSha: '$input.headSha', merge_method: 'squash', commit_title: '$node.reviewer.mergeTitle', commit_message: '$node.reviewer.summary' }, policy: policy(60000, 1) }),
    node('end_merged', 'end', 'Merged', 'PR merged after human approval', 1880, 60, { outcome: 'accepted' }),
    node('end_commit_ok', 'end', 'Commit accepted', 'push passes the gate', 1440, 180, { outcome: 'accepted' }),
    node('approve_issue', 'approval', 'Human: return?', 'admin confirms returning the change', 1220, 320, { timeoutMs: 86400000, disclose: ['repo', 'title', 'body'] }),
    node('issue', 'mcp', 'Raise return issue', 'issue_write (R2)', 1440, 320, { ...pin('issue_write'), grantId: grants.issue, target: 'github.com', arguments: { method: 'create', owner: '$input.owner', repo: '$input.repo', title: '$node.reviewer.issueTitle', body: '$node.reviewer.issueBody' }, policy: policy(60000, 1) }),
    node('end_returned', 'end', 'Returned', 'issue raised after human approval', 1660, 320, { outcome: 'returned' }),
  ];
  if (status) nodes.push(node('status', 'mcp', 'Publish commit status', 'create_commit_status (R2)', 300, 420, { installationId: status.installation.id, capability: STATUS_CAPABILITY, manifestDigest: status.installation.digest, grantId: status.grant, target: 'github.com', arguments: { owner: '$input.owner', repo: '$input.repo', sha: '$input.headSha', outcome: '$run.outcome', run: '$run.id' }, policy: policy(60000, 1) }));
  const edge = (id, from, to, extra = {}) => ({ id, from, to, ...extra });
  const edges = [
    edge('e1', 'intake', 'reviewer'), edge('e2', 'reviewer', 'gate_accept'),
    edge('e3', 'gate_accept', 'gate_kind', { branch: 'true' }), edge('e4', 'gate_accept', 'approve_issue', { branch: 'false' }),
    edge('e5', 'gate_kind', 'approve_merge', { branch: 'true' }), edge('e6', 'gate_kind', 'end_commit_ok', { branch: 'false' }),
    edge('e7', 'approve_merge', 'merge'), edge('e8', 'merge', 'end_merged'),
    edge('e9', 'approve_issue', 'issue'), edge('e10', 'issue', 'end_returned'),
    ...TOOLS.map((item) => edge(`tool_${item.id}`, 'reviewer', item.id, { role: 'tool' })),
    ...(status ? [edge('finalizer_status', 'intake', 'status', { role: 'finalizer' })] : []),
  ];
  return { kind: 'graph-v1', nodes, edges };
}
