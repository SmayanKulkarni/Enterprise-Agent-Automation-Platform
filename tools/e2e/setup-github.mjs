import { workflowAdmin as admin, digest } from './api.mjs';

const URL_ = 'https://api.githubcopilot.com/mcp/';
const id = process.env.GITHUB_MCP_INSTALLATION_ID;
const str = { type: 'string' };
const shape = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const out = (type) => shape({ result: { type } }, ['result']);

const CAPABILITIES = [
  { name: 'get_me', risk: 'R1', inputSchema: shape({}, []), outputSchema: out('object') },
  { name: 'list_commits', risk: 'R1', inputSchema: shape({ owner: str, repo: str, perPage: { type: 'number' } }, ['owner', 'repo']), outputSchema: out('array') },
  { name: 'search_repositories', risk: 'R1', inputSchema: shape({ query: str, perPage: { type: 'number' } }, ['query']), outputSchema: out('object') },
  { name: 'list_branches', risk: 'R2', inputSchema: shape({ owner: str, repo: str, perPage: { type: 'number' } }, ['owner', 'repo']), outputSchema: out('array') },
];

const live = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${process.env[`WORKFLOW_MCP_CREDENTIAL_${id.replaceAll('-', '').toUpperCase()}`]}` }, body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'tools/list' }) }).then((response) => response.text());
const names = new Set([...live.matchAll(/"name":"([a-z_]+)"/gu)].map((match) => match[1]));
for (const item of CAPABILITIES) if (!names.has(item.name)) throw new Error(`server does not expose ${item.name}`);
console.log('discovered on server:', CAPABILITIES.map((item) => item.name).join(', '));

const manifest = { version: '1.0.0', capabilities: CAPABILITIES };
const installation = { route: 'public', endpoint: URL_, health: 'healthy', manifest: { ...manifest, certified: true, digest: digest(manifest) } };
const existing = (await admin.projection('connector-installations')).find((item) => item.id.toLowerCase() === id);
if (existing) console.log('installation exists:', existing.state);
else console.log('certified ->', (await admin.command('workflow', 'certify', { id, installation }, { expectedVersion: 0 })).state);
