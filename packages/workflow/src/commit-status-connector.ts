import { digest } from '../../contracts/src/index.js';
import type { JsonSchema } from './graph.js';
import type { Installation } from './service.js';

export const STATUS_CONTEXT = 'workflow/pr-gate';
export const STATUS_TOOL = 'create_commit_status';
export const STATUS_ROUTE = '/api/connectors/github-status';

const STATES: Readonly<Record<string, 'success' | 'failure'>> = { accepted: 'success', completed: 'success', returned: 'failure', rejected: 'failure' };
const DESCRIPTIONS = { success: 'Gate passed after human approval', failure: 'Gate did not pass', error: 'Gate did not finish; re-run it' } as const;
const NAME = /^[A-Za-z0-9_.-]{1,100}$/u;
const SHA = /^[0-9a-f]{7,64}$/iu;
const RUN = /^[0-9a-f-]{36}$/iu;
const MAX_BODY = 16384;
const GITHUB_TIMEOUT_MS = 15000;

export const statusFor = (outcome: string): 'success' | 'failure' | 'error' => STATES[outcome] ?? 'error';

export interface StatusArguments { owner: string; repo: string; sha: string; outcome: string; run: string; }

export function commitStatusRequest(input: StatusArguments & { targetBase?: string }): { url: string; body: { state: 'success' | 'failure' | 'error'; context: string; description: string; target_url?: string } } {
  const { owner, repo, sha, outcome, run, targetBase } = input;
  if (typeof owner !== 'string' || !NAME.test(owner) || typeof repo !== 'string' || !NAME.test(repo) || typeof sha !== 'string' || !SHA.test(sha) || typeof outcome !== 'string' || typeof run !== 'string' || !RUN.test(run)) throw new Error('INVALID_STATUS_REQUEST');
  const state = statusFor(outcome);
  return { url: `https://api.github.com/repos/${owner}/${repo}/statuses/${sha}`, body: { state, context: STATUS_CONTEXT, description: `${DESCRIPTIONS[state]} (${outcome})`.slice(0, 140), ...(targetBase ? { target_url: `${targetBase}/#run-${run}` } : {}) } };
}

const text = { type: 'string' } as const;
const shape = (properties: JsonSchema['properties']): JsonSchema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const inputSchema = shape({ owner: text, repo: text, sha: text, outcome: text, run: text });
const outputSchema = shape({ state: text });

export const statusConnectorEndpoint = (origin: string): string => `${origin.replace(/\/+$/u, '')}${STATUS_ROUTE}`;

export async function certifiedStatusInstallation(endpoint: string): Promise<Omit<Installation, 'id'>> {
  const capabilities = [{ name: STATUS_TOOL, risk: 'R2' as const, targetFields: ['owner', 'repo', 'sha'], inputSchema, outputSchema }];
  const version = '1';
  return { route: 'public', endpoint, health: 'healthy', manifest: { version, capabilities, certified: true, digest: await digest({ version, capabilities }) } };
}

export interface StatusMcpRequest { method: string; authorization?: string | undefined; body: Uint8Array; }
export interface StatusMcpReply { status: number; body: unknown; }
export interface StatusMcpOptions { fetch?: typeof fetch; targetBase?: string | undefined; }

const rpc = (id: unknown, payload: Record<string, unknown>): StatusMcpReply => ({ status: 200, body: { jsonrpc: '2.0', id, ...payload } });
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export async function handleStatusMcp(request: StatusMcpRequest, options: StatusMcpOptions = {}): Promise<StatusMcpReply> {
  if (request.method !== 'POST') return { status: 405, body: { error: 'method not allowed' } };
  const token = request.authorization?.startsWith('Bearer ') ? request.authorization.slice(7).trim() : '';
  if (!token) return { status: 401, body: { error: 'unauthorised' } };
  if (request.body.length > MAX_BODY) return { status: 413, body: { error: 'too large' } };
  let message: unknown;
  try { message = JSON.parse(new TextDecoder().decode(request.body)); } catch { return { status: 400, body: { error: 'invalid json' } }; }
  if (!object(message)) return { status: 400, body: { error: 'invalid json' } };
  const { id, method, params } = message;
  if (method === 'initialize') return rpc(id, { result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'commit-status-mcp', version: '1.0.0' } } });
  if (method === 'tools/list') return rpc(id, { result: { tools: [{ name: STATUS_TOOL, description: 'Publish the gate result as a commit status on one commit.', inputSchema, outputSchema }] } });
  if (method !== 'tools/call' || !object(params) || params['name'] !== STATUS_TOOL) return rpc(id, { error: { code: -32601, message: 'method not found' } });
  try {
    const { url, body } = commitStatusRequest({ ...(object(params['arguments']) ? params['arguments'] : {}), ...(options.targetBase ? { targetBase: options.targetBase } : {}) } as unknown as StatusArguments & { targetBase?: string });
    const response = await (options.fetch ?? fetch)(url, { method: 'POST', headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'threadline-status-connector', 'x-github-api-version': '2022-11-28' }, body: JSON.stringify(body), signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`GitHub answered ${String(response.status)}`);
    const structuredContent = { state: body.state };
    return rpc(id, { result: { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent } });
  } catch (error) {
    return rpc(id, { result: { isError: true, content: [{ type: 'text', text: error instanceof Error && error.message.startsWith('GitHub answered') ? error.message : 'The commit status could not be published.' }] } });
  }
}
