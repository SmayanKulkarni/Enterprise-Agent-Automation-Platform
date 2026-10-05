import { createServer } from 'node:https';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statusRequest } from './commit-status.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.STATUS_MCP_PORT ?? 8444);
const required = (name) => process.env[name] || (() => { throw new Error(`Missing ${name}`); })();
const bearer = required('STATUS_MCP_TOKEN');
const githubToken = required('GITHUB_TOKEN');
const targetBase = process.env.PLATFORM_BASE_URL;
const MAX_BODY = 16384;

const str = { type: 'string' };
const shape = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const tool = {
  name: 'create_commit_status',
  description: 'Publish the gate result as a commit status on one commit.',
  inputSchema: shape({ owner: str, repo: str, sha: str, outcome: str, run: str }),
  outputSchema: shape({ state: str }),
};

const authorised = (header = '') => {
  const given = Buffer.from(header.replace(/^Bearer /u, '')); const expected = Buffer.from(bearer);
  return given.length === expected.length && timingSafeEqual(given, expected);
};

const publish = async (args) => {
  const { url, body } = statusRequest({ ...args, targetBase });
  const response = await fetch(url, { method: 'POST', headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${githubToken}`, 'content-type': 'application/json', 'user-agent': 'threadline-status-mcp', 'x-github-api-version': '2022-11-28' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`github answered ${response.status}`);
  return { state: body.state };
};

const handle = async ({ id, method, params }) => {
  if (method === 'initialize') return { jsonrpc: '2.0', id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'commit-status-mcp', version: '1.0.0' } } };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: [tool] } };
  if (method !== 'tools/call' || params?.name !== tool.name) return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } };
  try {
    const structuredContent = await publish(params.arguments ?? {});
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent } };
  } catch (error) {
    return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: error.message }] } };
  }
};

const reply = (response, status, body) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
const [key, cert] = await Promise.all([readFile(join(here, 'certs', 'key.pem')), readFile(join(here, 'certs', 'cert.pem'))]);
createServer({ key, cert }, (request, response) => {
  if (request.method !== 'POST' || request.url !== '/mcp') return reply(response, 404, { error: 'not found' });
  if (!authorised(request.headers.authorization)) return reply(response, 401, { error: 'unauthorised' });
  const chunks = []; let size = 0;
  request.on('data', (chunk) => { size += chunk.length; if (size > MAX_BODY) request.destroy(); else chunks.push(chunk); });
  request.on('end', () => {
    let message;
    try { message = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(response, 400, { error: 'invalid json' }); }
    handle(message).then((result) => reply(response, 200, result)).catch(() => reply(response, 500, { jsonrpc: '2.0', id: message.id ?? null, error: { code: -32603, message: 'internal error' } }));
  });
}).listen(port, '127.0.0.1', () => console.log(`commit status MCP on https://localhost:${port}/mcp`));
