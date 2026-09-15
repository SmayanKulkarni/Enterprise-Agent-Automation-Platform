import { clerkAuthorizationHeader } from '../../../packages/browser/src/clerk-authorization-header.js';

type GetToken = () => Promise<string | null>;

export interface Tenant {
  id: string;
  profiles: readonly string[];
}

export interface Session {
  tenantId: string;
}

export class PlatformApiError extends Error {
  constructor(readonly status: number) {
    super('Platform request failed.');
  }
}

export class PlatformApi {
  constructor(private readonly getToken: GetToken) {}

  async session(tenantId?: string, signal?: AbortSignal): Promise<Session> {
    const payload = await this.get('/api/v1/session', tenantId, signal);
    const tenant = object(payload)['tenant'];
    const id = object(tenant)['id'];
    if (typeof id !== 'string') throw new PlatformApiError(500);
    return { tenantId: id };
  }

  async tenants(signal?: AbortSignal): Promise<readonly Tenant[]> {
    const payload = await this.get('/api/v1/tenants', undefined, signal);
    const tenants = object(payload)['tenants'];
    if (!Array.isArray(tenants)) throw new PlatformApiError(500);
    return tenants.map((tenant) => {
      const record = object(tenant);
      if (typeof record['id'] !== 'string' || !Array.isArray(record['profiles']) || !record['profiles'].every((profile) => typeof profile === 'string')) throw new PlatformApiError(500);
      return { id: record['id'], profiles: record['profiles'] };
    });
  }

  private async get(path: string, tenantId: string | undefined, signal: AbortSignal | undefined): Promise<unknown> {
    const headers: Record<string, string> = { accept: 'application/vnd.platform.browser.v1+json', ...(await clerkAuthorizationHeader(this.getToken)) };
    if (tenantId !== undefined) headers['x-platform-tenant'] = tenantId;
    const response = await fetch(path, { headers, ...(signal === undefined ? {} : { signal }) });
    const body: unknown = await response.json();
    if (!response.ok) throw new PlatformApiError(response.status);
    return object(body)['payload'];
  }
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new PlatformApiError(500);
  return value as Record<string, unknown>;
}
