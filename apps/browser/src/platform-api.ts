import { clerkAuthorizationHeader } from '../../../packages/browser/src/clerk-authorization-header.js';

type GetToken = () => Promise<string | null>;

export interface Tenant {
  id: string;
  profiles: readonly string[];
}

export interface Session {
  tenantId: string;
}

export interface Projection {
  collection: string;
  records: readonly Record<string, unknown>[];
  completeness: 'full' | 'partial' | 'not-ready';
  classification: string;
  freshness: string;
  redaction: string;
}

export class PlatformApiError extends Error {
  constructor(readonly status: number, readonly category?: string) {
    super('Platform request failed.');
  }
}

export class PlatformApi {
  constructor(private readonly getToken: GetToken) {}

  async session(tenantId?: string, signal?: AbortSignal): Promise<Session> {
    const payload = await this.get('/api/v1/session', tenantId, signal);
    const tenant = record(payload)['tenant'];
    const id = record(tenant)['id'];
    if (typeof id !== 'string') throw new PlatformApiError(500);
    return { tenantId: id };
  }

  async tenants(signal?: AbortSignal): Promise<readonly Tenant[]> {
    const payload = await this.get('/api/v1/tenants', undefined, signal);
    const tenants = record(payload)['tenants'];
    if (!Array.isArray(tenants)) throw new PlatformApiError(500);
    return tenants.map((tenant) => {
      const tenantRecord = record(tenant);
      if (typeof tenantRecord['id'] !== 'string' || !Array.isArray(tenantRecord['profiles']) || !tenantRecord['profiles'].every((profile) => typeof profile === 'string')) throw new PlatformApiError(500);
      return { id: tenantRecord['id'], profiles: tenantRecord['profiles'] };
    });
  }

  async projection(tenantId: string, collection: string, signal?: AbortSignal): Promise<Projection> {
    const payload = record(await this.get(`/api/v1/tenants/${encodeURIComponent(tenantId)}/${collection}`, tenantId, signal));
    if (!Array.isArray(payload['records']) || typeof payload['collection'] !== 'string' || !['full', 'partial', 'not-ready'].includes(String(payload['completeness'])) || typeof payload['classification'] !== 'string' || typeof payload['freshness'] !== 'string' || typeof payload['redaction'] !== 'string') throw new PlatformApiError(500);
    return { collection: payload['collection'], records: payload['records'].map(record), completeness: payload['completeness'] as Projection['completeness'], classification: payload['classification'], freshness: payload['freshness'], redaction: payload['redaction'] };
  }

  private async get(path: string, tenantId: string | undefined, signal: AbortSignal | undefined): Promise<unknown> {
    const headers: Record<string, string> = { accept: 'application/vnd.platform.browser.v1+json', ...(await clerkAuthorizationHeader(this.getToken)) };
    if (tenantId !== undefined) headers['x-platform-tenant'] = tenantId;
    const response = await fetch(path, { headers, ...(signal === undefined ? {} : { signal }) });
    const body: unknown = await response.json();
    const payload = record(body)['payload'];
    if (!response.ok) throw new PlatformApiError(response.status, errorCategory(payload));
    return payload;
  }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new PlatformApiError(500);
  return value as Record<string, unknown>;
}

function errorCategory(payload: unknown): string | undefined {
  const error = payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>)['error'] : undefined;
  return error !== null && typeof error === 'object' && !Array.isArray(error) && typeof (error as Record<string, unknown>)['category'] === 'string' ? (error as Record<string, unknown>)['category'] as string : undefined;
}
