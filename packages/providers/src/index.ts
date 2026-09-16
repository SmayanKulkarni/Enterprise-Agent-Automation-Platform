import type { AdapterResult, NormalizedInvocation, ProviderAdapter } from '../../gateway/src/index.js';
import { tenantId } from '../../contracts/src/index.js';

export type ProviderName = 'graph' | 'sql' | 'blob' | 'boards' | 'jira';
export interface ProviderRequest { provider: ProviderName; tenantId: string; installationId: string; accountId: string; schemaVersion: string; credentialEpoch: number; operation: string; resource: string; effectId: string; arguments: Readonly<Record<string, unknown>>; deadline: string; }
export interface ProviderResponse { status: number; receipt?: string; checkpoint?: string; retryAfterSeconds?: number; }
export interface ProviderResetRequest { provider: ProviderName; tenantId: string; installationId: string; accountId: string; schemaVersion: string; credentialEpoch: number; scope: string; inventory: readonly string[]; }
/** The live host owns the short-lived credential; this port never records or returns it. */
export interface ProviderTransport { execute(request: Readonly<ProviderRequest>): Promise<ProviderResponse> | ProviderResponse; reconcile(request: Readonly<ProviderRequest>): Promise<{ found: boolean; checkpoint?: string }> | { found: boolean; checkpoint?: string }; reset(request: Readonly<ProviderResetRequest>): Promise<{ removed: readonly string[]; residual: readonly string[] }> | { removed: readonly string[]; residual: readonly string[] }; }
export interface ProviderCheckpoint { provider: ProviderName; tenantId: string; installationId: string; accountId: string; schemaVersion: string; credentialEpoch: number; scope: string; cursor: string; }

const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:@/-]{1,256}$/u.test(value) && !value.includes('..');
const safeCursor = (value: string | undefined): value is string => value !== undefined && /^[A-Za-z0-9._:@/-]{1,512}$/u.test(value) && !/(?:token|secret|bearer)/iu.test(value);
const frozen = <Value>(value: Value): Value => Object.freeze(value);
const assertIds = (...values: readonly unknown[]): void => { if (!values.every(safeId)) throw new Error('Invalid provider scope.'); };

/** Durable checkpoints are scope-bound; a different provider, install, account, or scope cannot advance one. */
export class ProviderCheckpoints {
  readonly #items = new Map<string, ProviderCheckpoint>();
  advance(input: ProviderCheckpoint): ProviderCheckpoint {
    if (!safeId(input.tenantId) || !safeId(input.installationId) || !safeId(input.accountId) || !safeId(input.schemaVersion) || !Number.isSafeInteger(input.credentialEpoch) || input.credentialEpoch < 1 || !safeId(input.scope) || !safeCursor(input.cursor)) throw new Error('Invalid provider checkpoint.');
    const key = `${input.provider}:${input.installationId}:${input.scope}`;
    const current = this.#items.get(key);
    if (current !== undefined && (current.tenantId !== input.tenantId || current.accountId !== input.accountId || current.schemaVersion !== input.schemaVersion || current.credentialEpoch !== input.credentialEpoch)) throw new Error('Provider checkpoint scope changed.');
    const checkpoint = frozen({ ...input }); this.#items.set(key, checkpoint); return checkpoint;
  }
  get(provider: ProviderName, installationId: string, scope: string): ProviderCheckpoint | undefined { return this.#items.get(`${provider}:${installationId}:${scope}`); }
}

interface AdapterConfig { provider: ProviderName; tenantId: string; installationId: string; accountId: string; schemaVersion: string; credentialEpoch: number; scope: string; }
abstract class ScopedAdapter implements ProviderAdapter {
  readonly #inventory = new Set<string>();
  constructor(protected readonly config: AdapterConfig, private readonly transport: ProviderTransport, private readonly checkpoints = new ProviderCheckpoints()) {
    tenantId(config.tenantId);
    if (![config.installationId, config.accountId, config.schemaVersion, config.scope].every(safeId) || !Number.isSafeInteger(config.credentialEpoch) || config.credentialEpoch < 1) throw new Error('Invalid provider installation scope.');
  }
  protected abstract permit(input: Readonly<NormalizedInvocation>): boolean;
  protected abstract mutates(operation: string): boolean;
  async invoke(input: Readonly<NormalizedInvocation>): Promise<AdapterResult> {
    if (input.credential.installationId !== this.config.installationId || input.accountId !== this.config.accountId || !this.permit(input)) return { outcome: 'provider-rejected' };
    const request = frozen({ provider: this.config.provider, tenantId: this.config.tenantId, installationId: this.config.installationId, accountId: this.config.accountId, schemaVersion: this.config.schemaVersion, credentialEpoch: this.config.credentialEpoch, operation: input.operation, resource: input.resource, effectId: input.effectId, arguments: frozen({ ...input.arguments }), deadline: input.deadline });
    try {
      const response = await this.transport.execute(request);
      if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599 || (response.receipt !== undefined && !safeId(response.receipt))) return { outcome: 'unknown-outcome' };
      if (response.status >= 200 && response.status < 300) { this.advance(response.checkpoint); if (this.mutates(input.operation) && response.receipt !== undefined) this.#inventory.add(response.receipt); return { outcome: 'succeeded', ...(response.receipt === undefined ? {} : { providerRef: response.receipt }) }; }
      const retryAfterSeconds = response.retryAfterSeconds;
      if (response.status === 429) return { outcome: 'throttled', ...(Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds !== undefined && retryAfterSeconds >= 0 ? { retryAfterSeconds } : {}) };
      return { outcome: response.status >= 500 ? 'retryable' : 'provider-rejected' };
    } catch { return { outcome: 'unknown-outcome' }; }
  }
  async reconcile(input: Readonly<NormalizedInvocation>): Promise<'succeeded' | 'not-found' | 'inconclusive'> {
    if (input.credential.installationId !== this.config.installationId || input.accountId !== this.config.accountId || !this.permit(input)) return 'inconclusive';
    try {
      const found = await this.transport.reconcile(frozen({ provider: this.config.provider, tenantId: this.config.tenantId, installationId: this.config.installationId, accountId: this.config.accountId, schemaVersion: this.config.schemaVersion, credentialEpoch: this.config.credentialEpoch, operation: input.operation, resource: input.resource, effectId: input.effectId, arguments: frozen({ ...input.arguments }), deadline: input.deadline }));
      if (!found.found) return 'not-found'; this.advance(found.checkpoint); return 'succeeded';
    } catch { return 'inconclusive'; }
  }
  checkpoint(): ProviderCheckpoint | undefined { return this.checkpoints.get(this.config.provider, this.config.installationId, this.config.scope); }
  async reset(): Promise<{ state: 'complete' | 'blocked'; residual: readonly string[] }> {
    const inventory = [...this.#inventory].sort(); const result = await this.transport.reset(frozen({ provider: this.config.provider, tenantId: this.config.tenantId, installationId: this.config.installationId, accountId: this.config.accountId, schemaVersion: this.config.schemaVersion, credentialEpoch: this.config.credentialEpoch, scope: this.config.scope, inventory }));
    if (result.residual.length || result.removed.length !== inventory.length || result.removed.some((id) => !this.#inventory.has(id))) return { state: 'blocked', residual: Object.freeze([...result.residual].sort()) };
    this.#inventory.clear(); return { state: 'complete', residual: Object.freeze([]) };
  }
  private advance(cursor: string | undefined): void { if (safeCursor(cursor)) this.checkpoints.advance({ provider: this.config.provider, tenantId: this.config.tenantId, installationId: this.config.installationId, accountId: this.config.accountId, schemaVersion: this.config.schemaVersion, credentialEpoch: this.config.credentialEpoch, scope: this.config.scope, cursor }); }
}

export interface GraphAdapterConfig extends Omit<AdapterConfig, 'provider'> { userIds: readonly string[]; groupId: string; }
/** Graph permits named-user/group reads and the allocated demo membership only. */
export class GraphAdapter extends ScopedAdapter {
  constructor(private readonly graph: GraphAdapterConfig, transport: ProviderTransport, checkpoints?: ProviderCheckpoints) { super({ ...graph, provider: 'graph' }, transport, checkpoints); assertIds(graph.groupId, ...graph.userIds); }
  protected permit(input: Readonly<NormalizedInvocation>): boolean {
    const users = new Set(this.graph.userIds); const group = `groups/${this.graph.groupId}`;
    return (input.operation === 'graph.user.read' && users.has(input.resource) && !Object.keys(input.arguments).length)
      || (input.operation === 'graph.group.read' && input.resource === group && !Object.keys(input.arguments).length)
      || ((input.operation === 'graph.membership.add' || input.operation === 'graph.membership.remove') && input.resource === group && Object.keys(input.arguments).length === 1 && users.has(input.arguments['userId'] as string));
  }
  protected mutates(operation: string): boolean { return operation === 'graph.membership.add' || operation === 'graph.membership.remove'; }
}

export interface SqlAdapterConfig extends Omit<AdapterConfig, 'provider'> { tables: readonly string[]; }
/** SQL transport receives only declared table names and named parameters, never executable SQL text. */
export class SqlAdapter extends ScopedAdapter {
  constructor(private readonly sql: SqlAdapterConfig, transport: ProviderTransport, checkpoints?: ProviderCheckpoints) { super({ ...sql, provider: 'sql' }, transport, checkpoints); assertIds(...sql.tables); }
  protected permit(input: Readonly<NormalizedInvocation>): boolean { return ['sql.aggregate', 'sql.upsert'].includes(input.operation) && this.sql.tables.includes(input.resource) && Object.keys(input.arguments).every((key) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key)); }
  protected mutates(operation: string): boolean { return operation === 'sql.upsert'; }
}

export interface BlobAdapterConfig extends Omit<AdapterConfig, 'provider'> { sourceManifest: string; outputPrefix: string; }
/** Blob paths are manifest/prefix confined and every write is conditional at the transport boundary. */
export class BlobAdapter extends ScopedAdapter {
  constructor(private readonly blob: BlobAdapterConfig, transport: ProviderTransport, checkpoints?: ProviderCheckpoints) { super({ ...blob, provider: 'blob' }, transport, checkpoints); assertIds(blob.sourceManifest, blob.outputPrefix); if (!blob.outputPrefix.endsWith('/')) throw new Error('Invalid provider scope.'); }
  protected permit(input: Readonly<NormalizedInvocation>): boolean {
    const path = safeId(input.resource) && !input.resource.includes('//');
    return (input.operation === 'blob.manifest.read' && input.resource === this.blob.sourceManifest && !Object.keys(input.arguments).length)
      || (input.operation === 'blob.artifact.write' && path && input.resource.startsWith(this.blob.outputPrefix) && typeof input.arguments['etag'] === 'string' && Object.keys(input.arguments).length === 1);
  }
  protected mutates(operation: string): boolean { return operation === 'blob.artifact.write'; }
}

export interface BoardsAdapterConfig extends Omit<AdapterConfig, 'provider'> { project: string; itemIds: readonly string[]; marker: string; }
/** Boards can read allocated items and mutate only records carrying its exact demo marker. */
export class BoardsAdapter extends ScopedAdapter {
  constructor(private readonly boards: BoardsAdapterConfig, transport: ProviderTransport, checkpoints?: ProviderCheckpoints) { super({ ...boards, provider: 'boards' }, transport, checkpoints); assertIds(boards.project, boards.marker, ...boards.itemIds); }
  protected permit(input: Readonly<NormalizedInvocation>): boolean {
    const item = `projects/${this.boards.project}/items/`;
    return (input.operation === 'boards.item.read' && this.boards.itemIds.includes(input.resource) && !Object.keys(input.arguments).length)
      || (input.operation === 'boards.item.upsert' && input.resource.startsWith(item) && input.arguments['marker'] === this.boards.marker && Object.keys(input.arguments).every((key) => ['marker', 'revision', 'fields'].includes(key)));
  }
  protected mutates(operation: string): boolean { return operation === 'boards.item.upsert'; }
}

export interface JiraAdapterConfig extends Omit<AdapterConfig, 'provider'> { site: string; project: string; evidenceIssueIds: readonly string[]; marker: string; }
/** Jira permits the approved site/project and marker-bound access-review effects only. */
export class JiraAdapter extends ScopedAdapter {
  constructor(private readonly jira: JiraAdapterConfig, transport: ProviderTransport, checkpoints?: ProviderCheckpoints) { super({ ...jira, provider: 'jira' }, transport, checkpoints); assertIds(jira.site, jira.project, jira.marker, ...jira.evidenceIssueIds); }
  protected permit(input: Readonly<NormalizedInvocation>): boolean {
    const prefix = `sites/${this.jira.site}/projects/${this.jira.project}/issues/`;
    return (input.operation === 'jira.evidence.read' && this.jira.evidenceIssueIds.includes(input.resource) && !Object.keys(input.arguments).length)
      || (['jira.review.create', 'jira.review.update', 'jira.review.revoke'].includes(input.operation) && input.resource.startsWith(prefix) && input.arguments['marker'] === this.jira.marker && Object.keys(input.arguments).every((key) => ['marker', 'version', 'fields'].includes(key)));
  }
  protected mutates(operation: string): boolean { return operation !== 'jira.evidence.read'; }
}
