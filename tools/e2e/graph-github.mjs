const MODEL = 'deepseek/deepseek-v4-flash-0731';
const policy = (milliseconds, effects = 0) => ({ milliseconds, attempts: 1, tokens: 0, cost: 0, toolRounds: 0, effects });
const schema = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOLS = [
  { id: 'g_me', site: 'github', capability: 'get_me', title: 'GitHub identity', y: 60 },
  { id: 'g_commits', site: 'github', capability: 'list_commits', title: 'GitHub commits', y: 180 },
  { id: 'g_search', site: 'github', capability: 'search_repositories', title: 'GitHub repo search', y: 300 },
  { id: 'g_report', site: 'files', capability: 'write_report', title: 'Write report file', y: 420 },
];

const INSTRUCTIONS = `You triage the health of a GitHub repository. The run input has "owner", "repo" and "focus".
Work one tool call at a time:
1. Call get_me to confirm which GitHub account the platform is authenticated as.
2. Call list_commits with owner, repo and perPage 5.
3. Call search_repositories with query "repo:<owner>/<repo>" and perPage 1.
4. Set needsAttention to true when the newest commit is older than 90 days or the repository is not found; otherwise false. Today's date is given in the commit data's recency; compare with the date of the newest commit and the current date ${new Date().toISOString().slice(0, 10)}.
5. Call write_report once with a short title and a markdown body that states the authenticated account login, the newest commit sha and date, the star count if present, and the focus question answer.
6. Finish with the final JSON. reportPath is the path write_report returned. Never invent figures.`;

export function buildGraph({ installations, grants }) {
  const node = (id, kind, title, detail, x, y, config, instructions = '') => ({ id, kind, title, detail, x, y, instructions, config });
  const tool = (item) => { const install = installations[item.site]; return node(item.id, 'mcp', item.title, item.capability, 760, item.y, { installationId: install.id, capability: item.capability, manifestDigest: install.digest, grantId: grants[item.id], target: item.site === 'github' ? 'github.com' : 'dependency-briefing-mcp', arguments: {}, policy: policy(60000, 1) }); };
  const github = installations.github;
  const nodes = [
    node('intake', 'trigger', 'Repo event', 'signed webhook: owner, repo, focus', 40, 200, { mode: 'webhook', inputSchema: schema({ owner: { type: 'string' }, repo: { type: 'string' }, focus: { type: 'string' } }, ['owner', 'repo', 'focus']) }),
    node('triager', 'agent', 'Repo triager', `openrouter ${MODEL}`, 300, 200, {
      provider: 'openrouter', model: MODEL, promptVersion: 'v1', openRouterOptIn: true, allowedCapabilities: ['list_branches'],
      responseSchema: schema({ summary: { type: 'string' }, activity: { type: 'string' }, needsAttention: { type: 'boolean' }, reportPath: { type: 'string' } }, ['summary', 'activity', 'needsAttention', 'reportPath']),
      policy: { milliseconds: 300000, attempts: 2, tokens: 60000, cost: 0.5, toolRounds: 10, effects: 6 },
    }, INSTRUCTIONS),
    ...TOOLS.map(tool),
    node('gate', 'condition', 'Needs attention?', 'needsAttention is true', 1000, 200, { source: 'triager', field: 'needsAttention', equals: true }),
    node('approve', 'approval', 'Human approval', 'admin approves branch listing', 1220, 120, { timeoutMs: 3600000 }),
    node('branches', 'mcp', 'List branches', 'list_branches (R2)', 1440, 120, { installationId: github.id, capability: 'list_branches', manifestDigest: github.digest, grantId: grants.branches, target: 'github.com', arguments: { owner: '$input.owner', repo: '$input.repo' }, policy: policy(60000, 1) }),
    node('end_escalated', 'end', 'Escalated', 'branches listed after approval', 1660, 120, {}),
    node('end_clear', 'end', 'Healthy', 'no escalation', 1220, 320, {}),
  ];
  const edge = (id, from, to, extra = {}) => ({ id, from, to, ...extra });
  const edges = [
    edge('e1', 'intake', 'triager'), edge('e2', 'triager', 'gate'),
    edge('e3', 'gate', 'approve', { branch: 'true' }), edge('e4', 'gate', 'end_clear', { branch: 'false' }),
    edge('e5', 'approve', 'branches'), edge('e6', 'branches', 'end_escalated'),
    ...TOOLS.map((item) => edge(`tool_${item.id}`, 'triager', item.id, { role: 'tool' })),
  ];
  return { kind: 'graph-v1', nodes, edges };
}
