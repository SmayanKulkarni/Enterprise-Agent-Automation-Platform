import { workflowAdmin as admin, digest } from './api.mjs';

const URL_ = 'https://api.githubcopilot.com/mcp/';
const id = process.env.PRGATE_MCP_INSTALLATION_ID;
const str = { type: 'string' };
const num = { type: 'number' };
const shape = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const out = (type) => shape({ result: { type } }, ['result']);

const CAPABILITIES = [
  { name: 'pull_request_get_diff', tool: 'pull_request_read', fixed: { method: 'get_diff' }, risk: 'R1', inputSchema: shape({ owner: str, repo: str, pullNumber: num }, ['owner', 'repo', 'pullNumber']), outputSchema: out('string') },
  { name: 'get_commit', risk: 'R1', inputSchema: shape({ owner: str, repo: str, sha: str, detail: str }, ['owner', 'repo', 'sha']), outputSchema: out('object') },
  { name: 'issue_write', risk: 'R2', targetFields: ['owner', 'repo'], inputSchema: shape({ method: str, owner: str, repo: str, title: str, body: str }, ['method', 'owner', 'repo', 'title', 'body']), outputSchema: out('object') },
  { name: 'merge_pull_request', risk: 'R3', targetFields: ['owner', 'repo', 'pullNumber', 'expectedHeadSha'], inputSchema: shape({ owner: str, repo: str, pullNumber: num, expectedHeadSha: str, merge_method: str, commit_title: str, commit_message: str }, ['owner', 'repo', 'pullNumber', 'expectedHeadSha', 'merge_method', 'commit_title', 'commit_message']), outputSchema: out('object') },
];

const token = process.env[`WORKFLOW_MCP_CREDENTIAL_${id.replaceAll('-', '').toUpperCase()}`];
const live = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'tools/list' }) }).then((response) => response.text());
const names = new Set([...live.matchAll(/"name":"([a-z_]+)"/gu)].map((match) => match[1]));
for (const item of CAPABILITIES) if (!names.has(item.tool ?? item.name)) throw new Error(`server does not expose ${item.tool ?? item.name}`);

const manifest = { version: '1.0.0', capabilities: CAPABILITIES };
const installation = { route: 'public', endpoint: URL_, health: 'healthy', manifest: { ...manifest, certified: true, digest: digest(manifest) } };
const existing = (await admin.projection('connector-installations')).find((item) => item.id.toLowerCase() === id);
if (existing) console.log('installation exists:', existing.state);
else console.log('certified ->', (await admin.command('workflow', 'certify', { id, installation }, { expectedVersion: 0 })).state);

const statusId = process.env.PRGATE_STATUS_INSTALLATION_ID;
if (statusId) {
  const str2 = { type: 'string' };
  const statusCapability = { name: 'create_commit_status', risk: 'R2', targetFields: ['owner', 'repo', 'sha'], inputSchema: shape({ owner: str2, repo: str2, sha: str2, outcome: str2, run: str2 }, ['owner', 'repo', 'sha', 'outcome', 'run']), outputSchema: shape({ state: str2 }, ['state']) };
  const statusManifest = { version: '1.0.0', capabilities: [statusCapability] };
  const statusInstallation = { route: 'public', endpoint: 'https://localhost:8444/mcp', health: 'healthy', manifest: { ...statusManifest, certified: true, digest: digest(statusManifest) } };
  const present = (await admin.projection('connector-installations')).find((item) => item.id.toLowerCase() === statusId);
  if (present) console.log('status installation exists:', present.state);
  else console.log('status certified ->', (await admin.command('workflow', 'certify', { id: statusId, installation: statusInstallation }, { expectedVersion: 0 })).state);
}
