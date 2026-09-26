const required = (name = '') => process.env[name]?.trim() || (() => { throw new Error(`Missing ${name}`); })();
const base = new URL(required('WORKFLOW_AGENT_BASE_URL'));
if (base.protocol !== 'https:') throw new Error('WORKFLOW_AGENT_BASE_URL must use HTTPS');
const tenantId = required('WORKFLOW_AGENT_TENANT_ID');
const installationId = required('WORKFLOW_AGENT_INSTALLATION_ID');
const token = required('WORKFLOW_AGENT_TOKEN');
const mcpUrl = new URL(required('WORKFLOW_AGENT_MCP_URL'));
if (!['http:', 'https:'].includes(mcpUrl.protocol)) throw new Error('WORKFLOW_AGENT_MCP_URL must use HTTP or HTTPS');
const mcpToken = process.env['WORKFLOW_AGENT_MCP_TOKEN']?.trim();
const endpoint = new URL(`/api/workflow-agent/${tenantId}/${installationId}/`, base);
const authorization = { authorization: `Bearer ${token}` };
const pause = (milliseconds = 0) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function resultFor(command = { effectId: '', deadline: '', capability: '', arguments: {} }) {
  const deadline = Date.parse(command.deadline);
  if (!Number.isFinite(deadline) || deadline <= Date.now()) return { effectId: command.effectId, outcome: 'failed' };
  try {
    const response = await fetch(mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...(mcpToken ? { authorization: `Bearer ${mcpToken}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: command.effectId, method: 'tools/call', params: { name: command.capability, arguments: command.arguments } }), signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
    if (!response.ok) return { effectId: command.effectId, outcome: 'unknown-outcome' };
    const body = await response.json();
    if (body.id !== command.effectId || body.error) return { effectId: command.effectId, outcome: 'unknown-outcome' };
    if (body.result?.isError) return { effectId: command.effectId, outcome: 'unknown-outcome' };
    const output = body.result?.structuredContent;
    return output && typeof output === 'object' && !Array.isArray(output) ? { effectId: command.effectId, outcome: 'succeeded', output } : { effectId: command.effectId, outcome: 'unknown-outcome' };
  } catch { return { effectId: command.effectId, outcome: 'unknown-outcome' }; }
}

while (true) {
  const response = await fetch(new URL('poll', endpoint), { headers: authorization }).catch(() => undefined);
  if (response?.status === 403) throw new Error('Installation token rejected');
  if (response?.status !== 200) { await pause(1000); continue; }
  const command = await response.json();
  const result = await resultFor(command);
  while (true) {
    const delivered = await fetch(new URL('result', endpoint), { method: 'POST', headers: { ...authorization, 'content-type': 'application/json' }, body: JSON.stringify(result) }).catch(() => undefined);
    if (delivered?.status === 200 || delivered?.status === 409) break;
    if (delivered?.status === 403) throw new Error('Installation token rejected');
    await pause(1000);
  }
}
