import { clerkAuthorizationHeader } from '../../../../packages/browser/src/clerk-authorization-header.js';
import { decodeCommandArguments } from '../../../../packages/browser/src/browser-contracts.js';
import { PlatformApiError, commandReceipt, mediaType, parseResponse, type CommandReceipt } from '../platform-api.js';
import { decodeAnswer, decodeGroups, decodeMembers, type AssistantAnswer, type AssistantRequest, type Group, type Members } from './decoders.js';

export type { Group } from './decoders.js';

export type GroupCommandName = 'create-group' | 'add-tenant' | 'remove-tenant' | 'add-admin' | 'remove-admin' | 'set-billing-tenant';
export interface GroupCommand { groupId?: string; name: GroupCommandName; expectedVersion: number; arguments: Record<string, unknown> }

export class GovernanceApi {
  private readonly commandKeys = new Map<string, string>();
  constructor(private readonly getToken: () => Promise<string | null>, private readonly apiOrigin = '') {}

  groups(signal?: AbortSignal): Promise<readonly Group[]> {
    return this.get('/api/v1/groups', decodeGroups, signal);
  }

  members(groupId: string, signal?: AbortSignal): Promise<Members> {
    return this.read(groupId, 'members', {}, decodeMembers, signal);
  }

  read<T>(groupId: string, collection: string, query: Readonly<Record<string, string>>, decode: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
    const search = new URLSearchParams(query);
    return this.get(`/api/v1/groups/${encodeURIComponent(groupId)}/${collection}${search.size ? `?${search}` : ''}`, decode, signal);
  }

  async command(command: GroupCommand, signal?: AbortSignal): Promise<CommandReceipt> {
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0) throw new PlatformApiError(400, 'invalid');
    let argumentsValue: Record<string, unknown>;
    try { argumentsValue = decodeCommandArguments('governance', command.name, command.arguments); } catch { throw new PlatformApiError(400, 'invalid'); }
    const retryKey = JSON.stringify([command.groupId, command.name, command.expectedVersion, argumentsValue]);
    const idempotencyKey = this.commandKeys.get(retryKey) ?? crypto.randomUUID();
    this.commandKeys.set(retryKey, idempotencyKey);
    const correlationId = crypto.randomUUID();
    const payload = { messageId: correlationId, contract: 'governance.v1', contractVersion: '1.0.0', occurredAt: new Date().toISOString(), correlationId, sender: 'platform-browser', classification: 'restricted-operational', payload: { expectedVersion: command.expectedVersion, arguments: argumentsValue } };
    const headers = { accept: mediaType, 'content-type': mediaType, 'if-match': String(command.expectedVersion), 'idempotency-key': idempotencyKey, 'x-correlation-id': correlationId, ...(await clerkAuthorizationHeader(this.getToken)) };
    const base = command.groupId === undefined ? '/api/v1/groups' : `/api/v1/groups/${encodeURIComponent(command.groupId)}`;
    const response = await fetch(`${this.apiOrigin}${base}/commands/governance/${command.name}`, { method: 'POST', headers, body: JSON.stringify(payload), ...(signal === undefined ? {} : { signal }) });
    return commandReceipt(await parseResponse(response, correlationId));
  }

  async ask(groupId: string, request: AssistantRequest, signal?: AbortSignal): Promise<AssistantAnswer> {
    const correlationId = crypto.randomUUID();
    const headers = { accept: mediaType, 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(), 'x-correlation-id': correlationId, ...(await clerkAuthorizationHeader(this.getToken)) };
    const response = await fetch(`${this.apiOrigin}/api/v1/groups/${encodeURIComponent(groupId)}/assistant`, { method: 'POST', headers, body: JSON.stringify(request), ...(signal === undefined ? {} : { signal }) });
    const payload = await parseResponse(response, correlationId);
    try { return decodeAnswer(payload); } catch (error) { throw error instanceof PlatformApiError ? error : new PlatformApiError(500); }
  }

  private async get<T>(path: string, decode: (value: unknown) => T, signal: AbortSignal | undefined): Promise<T> {
    const correlationId = crypto.randomUUID();
    const headers = { accept: mediaType, 'x-correlation-id': correlationId, ...(await clerkAuthorizationHeader(this.getToken)) };
    const response = await fetch(`${this.apiOrigin}${path}`, { headers, ...(signal === undefined ? {} : { signal }) });
    const payload = await parseResponse(response, correlationId);
    try { return decode(payload); } catch (error) { throw error instanceof PlatformApiError ? error : new PlatformApiError(500); }
  }
}
