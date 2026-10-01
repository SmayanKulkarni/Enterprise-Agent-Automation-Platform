import { report } from '../../errors/src/report.js';

export interface QueryBackend { url: string | undefined; user?: string; token?: string }
export interface Backends { prometheus: QueryBackend; loki: QueryBackend; tempo: QueryBackend }
export type Unready = { status: 'not-configured' | 'unavailable' };

const TIMEOUT_MS = 5000;
export const NONE: Backends = { prometheus: { url: undefined }, loki: { url: undefined }, tempo: { url: undefined } };

const isWebUrl = (value: string): boolean => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
};

const parseUrl = (name: string, value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!isWebUrl(trimmed)) throw new Error(`Invalid ${name}.`);
  return trimmed.replace(/\/+$/u, '');
};

export function backendsFromEnvironment(environment: Readonly<Record<string, string | undefined>>): Backends {
  const user = environment['GOVERNANCE_QUERY_USER']?.trim();
  const token = environment['GOVERNANCE_QUERY_TOKEN']?.trim();
  const auth = user && token ? { user, token } : {};
  const backend = (name: string): QueryBackend => ({ url: parseUrl(name, environment[name]), ...auth });
  return { prometheus: backend('GOVERNANCE_PROMETHEUS_URL'), loki: backend('GOVERNANCE_LOKI_URL'), tempo: backend('GOVERNANCE_TEMPO_URL') };
}

export async function backendJson(backend: QueryBackend, path: string, params: Readonly<Record<string, string>>, method: 'GET' | 'POST'): Promise<unknown> {
  const headers: Record<string, string> = backend.user && backend.token ? { authorization: `Basic ${Buffer.from(`${backend.user}:${backend.token}`).toString('base64')}` } : {};
  const search = new URLSearchParams(params);
  const post = method === 'POST';
  if (post) headers['content-type'] = 'application/x-www-form-urlencoded';
  const response = await fetch(`${backend.url ?? ''}${path}${post ? '' : `?${search.toString()}`}`, { method, headers, ...(post ? { body: search.toString() } : {}), signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((error: unknown) => {
    throw new Error(error instanceof DOMException && error.name === 'TimeoutError' ? 'Backend timed out.' : 'Backend request failed.');
  });
  if (!response.ok) throw new Error(`Backend answered ${String(response.status)}.`);
  return await response.json().catch(() => { throw new Error('Backend answered with invalid JSON.'); }) as unknown;
}

export async function guarded<Ready extends object>(site: string, backend: QueryBackend, read: () => Promise<Ready>): Promise<Ready | Unready> {
  if (backend.url === undefined) return { status: 'not-configured' };
  try { return await read(); } catch (error) {
    report(error, { site });
    return { status: 'unavailable' };
  }
}

export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
