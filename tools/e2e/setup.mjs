import { workflowAdmin as admin, digest } from './api.mjs';

const MCP_URL = 'https://localhost:8443/mcp';
const RISK = { npm_package_info: 'R1', github_repo_stats: 'R1', osv_advisories: 'R1', write_report: 'R2' };
const MODEL = 'deepseek/deepseek-v4-flash-0731';
const installationId = process.env.MCP_INSTALLATION_ID;

const rpc = async (method, params) => (await (await fetch(MCP_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: '1', method, params }) })).json()).result;

const connection = async () => {
  const records = await admin.projection('openrouter-connections');
  const current = records[0];
  console.log('openrouter connection:', current ? `${current.state} v${current.version}` : 'none');
  if (current?.state === 'ready') return;
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY missing');
  const receipt = await admin.post(`/tenants/${process.env.TENANT_ID ?? '11111111-1111-4111-8111-111111111111'}/openrouter-connection`, { action: 'connect', expectedVersion: current?.version ?? 0, key });
  console.log('connected ->', receipt.state);
};

const modelSettings = async () => {
  const [current] = await admin.projection('workflow-model-settings');
  console.log('model settings:', JSON.stringify(current));
  const wanted = { summary: { provider: 'openrouter', model: MODEL }, embedding: { provider: 'upstash' } };
  if (current && JSON.stringify({ summary: current.summary, embedding: current.embedding }) === JSON.stringify(wanted)) return;
  const receipt = await admin.command('workflow', 'configure-model-settings', { id: current.id, settings: wanted }, { expectedVersion: current.version });
  console.log('model settings saved ->', receipt.state);
};

const certify = async () => {
  const listed = (await rpc('tools/list', {})).tools;
  const capabilities = listed.map((tool) => ({ name: tool.name, risk: RISK[tool.name], inputSchema: tool.inputSchema, outputSchema: tool.outputSchema }));
  if (capabilities.some((item) => !item.risk)) throw new Error('unclassified tool');
  const manifest = { version: '1.0.0', capabilities };
  const installation = { route: 'public', endpoint: MCP_URL, health: 'healthy', manifest: { ...manifest, certified: true, digest: digest(manifest) } };
  const existing = (await admin.projection('connector-installations')).find((item) => item.id.toLowerCase() === installationId);
  console.log('installation:', existing ? `${existing.state} v${existing.version ?? '?'}` : 'none');
  if (existing) return;
  const receipt = await admin.command('workflow', 'certify', { id: installationId, installation }, { expectedVersion: 0 });
  console.log('certified ->', receipt.state, receipt.digest.slice(0, 12));
};

await connection();
await modelSettings();
await certify();
console.log('installations:', JSON.stringify(await admin.projection('connector-installations')).slice(0, 600));
