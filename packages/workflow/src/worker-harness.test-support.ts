import { createHash } from 'node:crypto';
import type { ExecutionContext } from '../../identity/src/index.js';
import { InMemoryHostedMemoryPort } from './memory.js';
import { WorkflowService, type Scheduler } from './service.js';
import { WorkflowWorker, type McpPort, type ModelPort } from './runtime.js';
import type { CapabilityPin, CompiledNode, JsonSchema, NodePolicy, WorkflowDefinition } from './graph.js';
import type { Installation, WorkflowRun } from './service.js';
import type { PublishedDefinition, RecordKind, WorkflowRecord, WorkflowStore } from './sql.js';

export const TENANT = '11111111-1111-4111-8111-111111111111';
export const DEFINITION = '22222222-2222-4222-8222-222222222222';
export const INSTALLATION = '33333333-3333-4333-8333-333333333333';
export const GRANT = '44444444-4444-4444-8444-444444444444';

export const shape = (properties: Record<string, { type: 'string' | 'number' | 'boolean' | 'object' | 'array' }>): JsonSchema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const POLICY: NodePolicy = { milliseconds: 60000, attempts: 1, tokens: 1000, cost: 1, toolRounds: 2, effects: 2 };

type Profile = 'editor' | 'admin' | 'operator';

export const contextFor = (userId: string): ExecutionContext => ({ mode: 'browser', userId, tenantId: TENANT, expiresAt: '2099-01-01T00:00:00.000Z', membershipEpoch: 1, tenantEpoch: 1 } as unknown as ExecutionContext);

export class MemoryRecords {
  readonly profiles = new Map<string, readonly Profile[]>();
  readonly receipts = new Map<string, string>();
  readonly records = new Map<string, WorkflowRecord<unknown>>();
  readonly published = new Map<string, PublishedDefinition>();
  private key(tenantId: string, kind: RecordKind, id: string): string { return `${tenantId}:${kind}:${id}`; }
  async assertProfile(context: ExecutionContext, profile: Profile): Promise<void> {
    if (this.profiles.size && !(this.profiles.get(context.userId) ?? []).includes(profile)) throw Object.assign(new Error('DENIED'), { code: 'DENIED' });
  }
  async read<T>(context: ExecutionContext, kind: RecordKind, id: string): Promise<WorkflowRecord<T> | undefined> { return this.workerRead<T>(String(context.tenantId), kind, id); }
  async list<T>(context: ExecutionContext, kind: RecordKind): Promise<WorkflowRecord<T>[]> { return this.workerList<T>(String(context.tenantId), kind); }
  async write(context: ExecutionContext, profile: Profile, kind: RecordKind, id: string, expectedVersion: number, state: string, data: unknown, key: string, requestDigest: string, receipt: Record<string, unknown>): Promise<{ receipt: Record<string, unknown>; replayed: boolean }> {
    await this.assertProfile(context, profile);
    const previous = this.receipts.get(key);
    if (previous !== undefined) { if (previous !== requestDigest) throw Object.assign(new Error('CONFLICT'), { code: 'CONFLICT' }); return { receipt, replayed: true }; }
    await this.workerWrite(String(context.tenantId), kind, id, expectedVersion, state, data);
    this.receipts.set(key, requestDigest);
    return { receipt, replayed: false };
  }
  async workerRead<T>(tenantId: string, kind: RecordKind, id: string): Promise<WorkflowRecord<T> | undefined> { return this.records.get(this.key(tenantId, kind, id)) as WorkflowRecord<T> | undefined; }
  async workerList<T>(tenantId: string, kind: RecordKind): Promise<WorkflowRecord<T>[]> { return [...this.records.entries()].filter(([key]) => key.startsWith(`${tenantId}:${kind}:`)).map(([, value]) => value as WorkflowRecord<T>); }
  async workerWrite<T>(tenantId: string, kind: RecordKind, id: string, expectedVersion: number, state: string, data: T): Promise<WorkflowRecord<T>> {
    const key = this.key(tenantId, kind, id);
    if ((this.records.get(key)?.version ?? 0) !== expectedVersion) throw Object.assign(new Error('STALE'), { code: 'STALE' });
    const value = { id, kind, version: expectedVersion + 1, state, data } as WorkflowRecord<T>;
    this.records.set(key, value as WorkflowRecord<unknown>);
    return value;
  }
  async definitions(context: ExecutionContext, id?: string): Promise<PublishedDefinition[]> { return [...this.published.entries()].filter(([key, value]) => key.startsWith(`${context.tenantId}:`) && (!id || value.id === id)).map(([, value]) => value); }
  async workerDefinition(tenantId: string, id: string): Promise<PublishedDefinition | undefined> { return this.published.get(`${tenantId}:${id}`); }
}

export const asStore = (records: MemoryRecords): WorkflowStore => records as unknown as WorkflowStore;

export interface PinSpec { risk: 'R1' | 'R2' | 'R3'; capability: string; inputSchema: JsonSchema; outputSchema: JsonSchema; }

export const pinFor = (nodeId: string, spec: PinSpec): CapabilityPin => ({ nodeId, installationId: INSTALLATION, manifestDigest: 'manifest', grantId: GRANT, ...spec });

export const mcpNode = (id: string, spec: PinSpec, args: Record<string, unknown>, extra: Partial<CompiledNode> = {}): CompiledNode => ({ id, kind: 'mcp', config: { installationId: INSTALLATION, capability: spec.capability, manifestDigest: 'manifest', grantId: GRANT, target: 'repo', arguments: args, policy: POLICY }, next: null, ...extra });

export function publish(records: MemoryRecords, nodes: readonly CompiledNode[], pins: readonly CapabilityPin[], start = 'trigger'): WorkflowDefinition {
  const body = { id: DEFINITION, revision: 1, start, nodes, capabilityPins: pins };
  const definition: WorkflowDefinition = { ...body, digest: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
  records.published.set(`${TENANT}:${DEFINITION}`, { id: DEFINITION, draftId: DEFINITION, draftRevision: 1, digest: definition.digest, definition });
  return definition;
}

export function install(records: MemoryRecords, pins: readonly CapabilityPin[]): void {
  const installation: Installation = { id: INSTALLATION, route: 'public', endpoint: 'https://mcp.example/mcp', health: 'healthy', manifest: { digest: 'manifest', version: '1', certified: true, capabilities: pins.map((pin) => ({ name: pin.capability, risk: pin.risk, inputSchema: pin.inputSchema, outputSchema: pin.outputSchema })) } };
  records.records.set(`${TENANT}:installation:${INSTALLATION}`, { id: INSTALLATION, kind: 'installation', version: 1, state: 'healthy', data: installation } as WorkflowRecord<unknown>);
  records.records.set(`${TENANT}:grant:${GRANT}`, { id: GRANT, kind: 'grant', version: 1, state: 'active', data: {} } as WorkflowRecord<unknown>);
}

export async function seedRun(records: MemoryRecords, definition: WorkflowDefinition, runId: string, input: Record<string, unknown>, patch: Partial<WorkflowRun> = {}): Promise<WorkflowRecord<WorkflowRun>> {
  const run: WorkflowRun = { id: runId, tenantId: TENANT, ownerId: 'webhook:test', stableDefinitionId: DEFINITION, definitionId: DEFINITION, definitionRevision: 1, definitionDigest: definition.digest, inputDigest: 'd', input, status: 'running', history: [], outputs: {}, ...patch };
  return records.workerWrite(TENANT, 'run', runId, 0, run.status, run);
}

export const worker = (records: MemoryRecords, model: ModelPort, mcp: McpPort): WorkflowWorker => new WorkflowWorker(asStore(records), model, mcp, new InMemoryHostedMemoryPort([]));

export const readRun = async (records: MemoryRecords, runId: string): Promise<WorkflowRecord<WorkflowRun>> => (await records.workerRead<WorkflowRun>(TENANT, 'run', runId))!;

export const WRITE_SPEC: PinSpec = { risk: 'R2', capability: 'write_issue', inputSchema: shape({ title: { type: 'string' } }), outputSchema: shape({ result: { type: 'string' } }) };
export const idle = { invoke: async () => ({ outcome: 'not-dispatched' as const }) };
export const unusedModel = { complete: async (): Promise<never> => { throw new Error('unused'); } };

export async function awaitingApproval(runId: string, starter: string, gate: Record<string, unknown> = {}, patch: Partial<WorkflowRun> = {}) {
  const records = new MemoryRecords(); const pin = pinFor('act', WRITE_SPEC);
  install(records, [pin]);
  const definition = publish(records, [
    { id: 'trigger', kind: 'trigger', config: {}, next: 'gate' },
    { id: 'gate', kind: 'approval', config: { timeoutMs: 60000, disclose: ['title'], ...gate }, next: 'act' },
    mcpNode('act', WRITE_SPEC, { title: '$input.title' }, { next: 'end' }),
    { id: 'end', kind: 'end', config: {}, next: null },
  ], [pin]);
  await seedRun(records, definition, runId, { title: 'PR 7' }, { ownerId: starter, ...patch });
  const step = await worker(records, unusedModel, idle).step(TENANT, runId, definition.id, 'gate');
  const raised: unknown[] = [];
  const scheduler: Scheduler = { start: async () => {}, raise: async (_run, _name, value) => { raised.push(value); } };
  return { records, definition, step, service: new WorkflowService({} as never, asStore(records), scheduler), raised };
}
