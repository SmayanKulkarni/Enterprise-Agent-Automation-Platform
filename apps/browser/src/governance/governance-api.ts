import { clerkAuthorizationHeader } from '../../../../packages/browser/src/clerk-authorization-header.js';
import { PlatformApiError, mediaType, parseResponse } from '../platform-api.js';
import { decodeGroups, type Group } from './decoders.js';

export type { Group } from './decoders.js';

export class GovernanceApi {
  constructor(private readonly getToken: () => Promise<string | null>, private readonly apiOrigin = '') {}

  groups(signal?: AbortSignal): Promise<readonly Group[]> {
    return this.get('/api/v1/groups', decodeGroups, signal);
  }

  read<T>(groupId: string, collection: string, query: Readonly<Record<string, string>>, decode: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
    const search = new URLSearchParams(query);
    return this.get(`/api/v1/groups/${encodeURIComponent(groupId)}/${collection}${search.size ? `?${search}` : ''}`, decode, signal);
  }

  private async get<T>(path: string, decode: (value: unknown) => T, signal: AbortSignal | undefined): Promise<T> {
    const correlationId = crypto.randomUUID();
    const headers = { accept: mediaType, 'x-correlation-id': correlationId, ...(await clerkAuthorizationHeader(this.getToken)) };
    const response = await fetch(`${this.apiOrigin}${path}`, { headers, ...(signal === undefined ? {} : { signal }) });
    const payload = await parseResponse(response, correlationId);
    try { return decode(payload); } catch (error) { throw error instanceof PlatformApiError ? error : new PlatformApiError(500); }
  }
}
