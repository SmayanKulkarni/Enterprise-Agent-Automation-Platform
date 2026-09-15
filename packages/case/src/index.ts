import { canonicalJson, digest, tenantId, type TenantId } from '../../contracts/src/index.js';

export type CaseState = 'draft' | 'ready' | 'active' | 'waiting-time' | 'waiting-information' | 'waiting-approval' | 'waiting-dependency' | 'compensating' | 'succeeded' | 'failed' | 'cancelled' | 'archived';
export type CaseCommandName = 'submit' | 'start' | 'cancel' | 'wait-time' | 'request-information' | 'request-approval' | 'wait-dependency' | 'begin-compensation' | 'succeed' | 'fail' | 'timer-fired' | 'provide-information' | 'reject' | 'approve' | 'expire' | 'dependency-resolved' | 'dependency-failed' | 'compensation-complete' | 'compensation-failed' | 'archive' | 'reopen';
export interface PackagePin { name: string; version: string; digest: string; }
export interface CaseCommand { id: string; tenantId: TenantId; name: CaseCommandName; expectedGeneration: number; expectedVersion: number; idempotencyKey: string; argumentDigest: string; authority: 'allow' | 'deny'; }
export interface CaseEvent { type: 'case.transitioned' | 'case.reopened'; commandId: string; name: CaseCommandName; state: CaseState; generation: number; version: number; digest: string; }
export interface CaseReceipt { commandId: string; idempotencyKey: string; argumentDigest: string; events: readonly CaseEvent[]; }
export interface CaseRecord { id: string; tenantId: TenantId; packagePin: PackagePin; state: CaseState; generation: number; version: number; outcome?: 'succeeded' | 'failed' | 'cancelled'; history: readonly CaseEvent[]; receipts: Readonly<Record<string, CaseReceipt>>; }
export class CaseError extends Error { constructor(public readonly code: 'DENIED' | 'CONFLICT' | 'STALE' | 'INVALID') { super('Case command was not accepted.'); this.name = 'CaseError'; } }
const fail = (code: CaseError['code']): never => { throw new CaseError(code); };

const destinations: Readonly<Record<CaseState, Partial<Record<CaseCommandName, CaseState>>>> = {
  draft: { submit: 'ready', cancel: 'cancelled' }, ready: { start: 'active', cancel: 'cancelled' },
  active: { 'wait-time': 'waiting-time', 'request-information': 'waiting-information', 'request-approval': 'waiting-approval', 'wait-dependency': 'waiting-dependency', 'begin-compensation': 'compensating', succeed: 'succeeded', fail: 'failed', cancel: 'cancelled' },
  'waiting-time': { 'timer-fired': 'ready', cancel: 'cancelled' }, 'waiting-information': { 'provide-information': 'ready', reject: 'failed', fail: 'failed', cancel: 'cancelled' },
  'waiting-approval': { approve: 'ready', reject: 'failed', expire: 'failed', cancel: 'cancelled' }, 'waiting-dependency': { 'dependency-resolved': 'ready', 'dependency-failed': 'failed', cancel: 'cancelled' },
  compensating: { 'compensation-complete': 'cancelled', 'compensation-failed': 'failed' }, succeeded: { archive: 'archived', reopen: 'draft' }, failed: { archive: 'archived', reopen: 'draft' }, cancelled: { archive: 'archived', reopen: 'draft' }, archived: {},
};
const terminals = new Set<CaseState>(['succeeded', 'failed', 'cancelled']);

export function createCase(input: { id: string; tenantId: string; packagePin: PackagePin }): CaseRecord {
  if (!input.id || !input.packagePin.name || !input.packagePin.version || !input.packagePin.digest) fail('INVALID');
  return { id: input.id, tenantId: tenantId(input.tenantId), packagePin: { ...input.packagePin }, state: 'draft', generation: 1, version: 0, history: [], receipts: {} };
}
export async function decideCase(current: CaseRecord, command: CaseCommand): Promise<CaseReceipt> {
  if (command.authority !== 'allow' || command.tenantId !== current.tenantId) fail('DENIED');
  const prior = current.receipts[command.idempotencyKey];
  if (prior !== undefined) { if (prior.argumentDigest !== command.argumentDigest) fail('CONFLICT'); return prior; }
  if (command.expectedGeneration !== current.generation || command.expectedVersion !== current.version) fail('STALE');
  const state = destinations[current.state][command.name]; if (state === undefined) throw new CaseError('CONFLICT');
  const generation = command.name === 'reopen' ? current.generation + 1 : current.generation; const version = current.version + 1;
  const event: CaseEvent = { type: command.name === 'reopen' ? 'case.reopened' : 'case.transitioned', commandId: command.id, name: command.name, state, generation, version, digest: await digest({ caseId: current.id, tenantId: current.tenantId, command: { ...command, tenantId: String(command.tenantId) }, packagePin: current.packagePin }) };
  return { commandId: command.id, idempotencyKey: command.idempotencyKey, argumentDigest: command.argumentDigest, events: [event] };
}
export function evolveCase(current: CaseRecord, receipt: CaseReceipt): CaseRecord {
  const event = receipt.events.at(-1); if (event === undefined || event.generation < current.generation || event.version !== current.version + 1) throw new CaseError('INVALID');
  const duplicate = current.receipts[receipt.idempotencyKey]; if (duplicate !== undefined) return duplicate.argumentDigest === receipt.argumentDigest ? current : fail('CONFLICT');
  const expectedState = destinations[current.state][event.name];
  if (expectedState !== event.state || event.generation !== current.generation + (event.name === 'reopen' ? 1 : 0)) fail('CONFLICT');
  const state = event.state; const outcome = terminals.has(state) ? state as NonNullable<CaseRecord['outcome']> : current.outcome;
  if (current.outcome !== undefined && event.name !== 'archive' && event.name !== 'reopen') fail('CONFLICT');
  const next: CaseRecord = { ...current, state, generation: event.generation, version: event.version, ...(outcome === undefined ? {} : { outcome }), history: [...current.history, ...receipt.events], receipts: { ...current.receipts, [receipt.idempotencyKey]: receipt } };
  if (event.name === 'reopen') delete next.outcome;
  return next;
}
export async function commandCase(current: CaseRecord, command: CaseCommand): Promise<CaseRecord> { return evolveCase(current, await decideCase(current, command)); }
export async function stateDigest(current: CaseRecord): Promise<string> { return digest(JSON.parse(canonicalJson({ ...current, tenantId: String(current.tenantId) }))); }
export * from './runtime.js';
