const MODEL = 'deepseek/deepseek-v4-flash-0731';
const policy = (milliseconds, effects = 0, extra = {}) => ({ milliseconds, attempts: 1, tokens: 0, cost: 0, toolRounds: 0, effects, ...extra });
const schema = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOLS = [
  { id: 't_npm', capability: 'npm_package_info', title: 'npm registry', y: 80 },
  { id: 't_github', capability: 'github_repo_stats', title: 'GitHub stats', y: 200 },
  { id: 't_osv', capability: 'osv_advisories', title: 'OSV advisories', y: 320 },
  { id: 't_report', capability: 'write_report', title: 'Write report file', y: 440 },
];

const INSTRUCTIONS = `You are a dependency due-diligence analyst. The run input has "package" (an npm package name) and "question".
Work in this order, one tool call at a time:
1. Call memory_search with the package name as query and subject set to "npm:" followed by the lowercase package name, to see what earlier briefings recorded.
2. Call npm_package_info, then github_repo_stats using the repository value it returns (owner/name), then osv_advisories.
3. Decide riskLevel as one of low, medium, high. Set needsHumanReview to true only when riskLevel is high, the repository is archived, or advisoryCount is above 5.
4. Call write_report once with a short title and a markdown body that answers the question and cites the exact figures you retrieved (downloads, stars, last publish, advisory count and ids).
5. Call memory_save once per verified finding (at most two) with type "task-fact". Set source to the call id of the tool result that contains the finding, subjects to ["npm:<lowercase package name>"], excerpt to text copied exactly from that tool result, and write text using only numbers, versions and ids that appear in that tool result.
6. Finish with the final JSON. reportPath is the path write_report returned. Use only figures that tool results returned; never invent numbers.`;

export function buildGraph({ installationId, manifestDigest, grants }) {
  const node = (id, kind, title, detail, x, y, config, instructions = '') => ({ id, kind, title, detail, x, y, instructions, config });
  const tool = (item) => node(item.id, 'mcp', item.title, item.capability, 760, item.y, { installationId, capability: item.capability, manifestDigest, grantId: grants[item.id], target: 'dependency-briefing-mcp', arguments: {}, policy: policy(60000, 1) });
  const nodes = [
    node('intake', 'trigger', 'Briefing request', 'package and question', 40, 200, { mode: 'manual', inputSchema: schema({ package: { type: 'string' }, question: { type: 'string' } }, ['package', 'question']) }),
    node('recall', 'memory', 'Recall prior briefings', 'Upstash operational memory', 260, 200, { limit: 5, maxChars: 2000, policy: policy(30000) }),
    node('analyst', 'agent', 'Dependency analyst', `openrouter ${MODEL}`, 500, 200, {
      provider: 'openrouter', model: MODEL, promptVersion: 'v1', openRouterOptIn: true, allowedCapabilities: [],
      responseSchema: schema({ summary: { type: 'string' }, riskLevel: { type: 'string' }, recommendation: { type: 'string' }, needsHumanReview: { type: 'boolean' }, reportPath: { type: 'string' }, memoryProposals: { type: 'array' } }, ['summary', 'riskLevel', 'recommendation', 'needsHumanReview', 'reportPath']),
      policy: { milliseconds: 300000, attempts: 2, tokens: 60000, cost: 0.5, toolRounds: 12, effects: 6 },
    }, INSTRUCTIONS),
    ...TOOLS.map(tool),
    node('t_memory', 'memory', 'Agent memory', 'memory_search and memory_save', 760, 560, { limit: 5, maxChars: 2000, policy: policy(30000) }),
    node('gate', 'condition', 'Needs human review?', 'needsHumanReview is true', 1000, 200, { source: 'analyst', field: 'needsHumanReview', equals: true }),
    node('end_review', 'end', 'Escalated', 'flagged for review', 1220, 120, {}),
    node('end_clear', 'end', 'Cleared', 'no escalation', 1220, 300, {}),
  ];
  const edge = (id, from, to, extra = {}) => ({ id, from, to, ...extra });
  const edges = [
    edge('e1', 'intake', 'recall'), edge('e2', 'recall', 'analyst'), edge('e3', 'analyst', 'gate'),
    edge('e4', 'gate', 'end_review', { branch: 'true' }), edge('e5', 'gate', 'end_clear', { branch: 'false' }),
    ...[...TOOLS.map((item) => item.id), 't_memory'].map((id) => edge(`tool_${id}`, 'analyst', id, { role: 'tool' })),
  ];
  return { kind: 'graph-v1', nodes, edges };
}
