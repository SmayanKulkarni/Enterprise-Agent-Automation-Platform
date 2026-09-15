import { canonicalJson, digest, tenantId, type TenantId } from '../../contracts/src/index.js';
import { type CaseCommand, type CaseReceipt, type CaseRecord, commandCase, createCase, stateDigest } from './index.js';

export class RuntimeError extends Error {
  constructor(public readonly code: 'CONFLICT' | 'DENIED' | 'NOT_FOUND' | 'STALE' | 'INVALID' | 'UNKNOWN_OUTCOME') {
    super('Runtime request was not accepted.');
    this.name = 'RuntimeError';
  }
}
const fail = (code: RuntimeError['code']): never => { throw new RuntimeError(code); };
const same = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);
function required<T>(value: T | undefined, code: RuntimeError['code']): T { if (value === undefined) throw new RuntimeError(code); return value; }

export type ActivityKind = 'time' | 'random' | 'model' | 'configuration' | 'effect-receipt';
export interface RecordedActivity { caseId: string; generation: number; version: number; key: string; kind: ActivityKind; value: unknown; }
export interface DurableTimer { id: string; caseId: string; generation: number; version: number; dueAt: string; fired: boolean; }
interface CaseHistory { initial: { id: string; tenantId: string; packagePin: CaseRecord['packagePin'] }; receipts: CaseReceipt[]; activities: RecordedActivity[]; timers: DurableTimer[]; }

/** Deterministic local workflow adapter. Leases are intentionally absent: version fences are the writer lock. */
export class InMemoryCaseWorkflow {
  readonly #histories = new Map<string, CaseHistory>();

  start(input: { id: string; tenantId: string; packagePin: CaseRecord['packagePin'] }): CaseRecord {
    if (this.#histories.has(input.id)) fail('CONFLICT');
    const current = createCase(input);
    this.#histories.set(input.id, { initial: { ...input, packagePin: { ...input.packagePin } }, receipts: [], activities: [], timers: [] });
    return current;
  }

  async command(caseId: string, command: CaseCommand): Promise<CaseRecord> {
    const history = this.history(caseId); const current = this.replay(caseId);
    const next = await commandCase(current, command);
    const receipt = required(next.receipts[command.idempotencyKey], 'INVALID');
    if (!current.receipts[command.idempotencyKey]) history.receipts.push(receipt);
    return next;
  }

  replay(caseId: string): CaseRecord {
    const history = this.history(caseId);
    let current: CaseRecord = createCase(history.initial);
    for (const receipt of history.receipts) {
      const event = required(receipt.events.at(-1), 'INVALID');
      const outcome = event.state === 'succeeded' || event.state === 'failed' || event.state === 'cancelled' ? event.state : event.name === 'reopen' ? undefined : current.outcome;
      current = { ...current, state: event.state, generation: event.generation, version: event.version, ...(outcome === undefined ? {} : { outcome }), history: [...current.history, ...receipt.events], receipts: { ...current.receipts, [receipt.idempotencyKey]: receipt } };
    }
    return current;
  }

  async activity<T>(caseId: string, fence: { generation: number; version: number }, key: string, kind: ActivityKind, run: () => T | Promise<T>): Promise<T> {
    const history = this.history(caseId); const current = this.replay(caseId);
    if (current.generation !== fence.generation || current.version !== fence.version) fail('STALE');
    const prior = history.activities.find((activity) => activity.key === key);
    if (prior !== undefined) { if (prior.kind !== kind) fail('CONFLICT'); return prior.value as T; }
    const value = await run();
    if (this.replay(caseId).generation !== fence.generation || this.replay(caseId).version !== fence.version) fail('STALE');
    history.activities.push({ caseId, ...fence, key, kind, value });
    return value;
  }

  scheduleTimer(caseId: string, fence: { generation: number; version: number }, id: string, dueAt: string): DurableTimer {
    const history = this.history(caseId); const current = this.replay(caseId);
    if (current.generation !== fence.generation || current.version !== fence.version || Number.isNaN(Date.parse(dueAt))) fail('STALE');
    const prior = history.timers.find((timer) => timer.id === id);
    if (prior !== undefined) { if (prior.generation !== fence.generation || prior.version !== fence.version || prior.dueAt !== dueAt) fail('CONFLICT'); return prior; }
    const timer = { caseId, ...fence, id, dueAt, fired: false }; history.timers.push(timer); return timer;
  }

  async fireTimer(caseId: string, id: string, command: CaseCommand): Promise<CaseRecord> {
    const timer = required(this.history(caseId).timers.find((candidate) => candidate.id === id), 'NOT_FOUND');
    if (timer.fired) return this.replay(caseId); if (command.name !== 'timer-fired' || command.expectedGeneration !== timer.generation || command.expectedVersion !== timer.version) fail('STALE');
    const next = await this.command(caseId, command); timer.fired = true; return next;
  }

  async replayDigest(caseId: string): Promise<string> { return stateDigest(this.replay(caseId)); }
  history(caseId: string): CaseHistory { const history = this.#histories.get(caseId); return history ?? fail('NOT_FOUND'); }
}

export type InterventionType = 'information-request' | 'approval-request' | 'correction' | 'operator-recovery' | 'break-glass';
export type JoinPolicy = { kind: 'all' } | { kind: 'first-valid' } | { kind: 'quorum'; count: number };
export interface InterventionRequest { id: string; tenantId: TenantId; caseId: string; generation: number; version: number; type: InterventionType; responders: readonly string[]; join: JoinPolicy; deadline: string; argumentDigest: string; }
export interface InterventionResponse { id: string; requestId: string; responderId: string; idempotencyKey: string; content: unknown; contentDigest: string; authorized: boolean; at: string; }
export interface InterventionReceipt { requestId: string; responseId: string; completed: boolean; duplicate: boolean; late: boolean; }
interface StoredIntervention { request: InterventionRequest; closed: boolean; responses: InterventionResponse[]; keys: Map<string, InterventionReceipt>; }

export class InterventionRuntime {
  readonly #requests = new Map<string, StoredIntervention>();
  open(input: InterventionRequest): InterventionRequest {
    const responders = [...new Set(input.responders)];
    if (this.#requests.has(input.id) || !responders.length || Number.isNaN(Date.parse(input.deadline)) || (input.join.kind === 'quorum' && (input.join.count < 1 || input.join.count > responders.length))) fail('INVALID');
    const request = { ...input, tenantId: tenantId(input.tenantId), responders }; this.#requests.set(request.id, { request, closed: false, responses: [], keys: new Map() }); return request;
  }
  respond(input: InterventionResponse, current: { tenantId: TenantId; generation: number; version: number }): InterventionReceipt {
    const stored = required(this.#requests.get(input.requestId), 'NOT_FOUND'); const prior = stored.keys.get(input.idempotencyKey);
    if (prior !== undefined) { const priorResponse = stored.responses.find((response) => response.idempotencyKey === input.idempotencyKey); if (priorResponse === undefined || priorResponse.contentDigest !== input.contentDigest) fail('CONFLICT'); return { ...prior, duplicate: true }; }
    const valid = input.authorized && stored.request.tenantId === current.tenantId && stored.request.generation === current.generation && stored.request.version === current.version && stored.request.responders.includes(input.responderId) && Date.parse(input.at) <= Date.parse(stored.request.deadline);
    if (!valid) fail('DENIED');
    const response = { ...input }; stored.responses.push(response);
    const accepted = stored.responses.filter((candidate) => candidate.authorized);
    const completed = !stored.closed && (stored.request.join.kind === 'first-valid' ? accepted.length >= 1 : stored.request.join.kind === 'quorum' ? accepted.length >= stored.request.join.count : accepted.length >= stored.request.responders.length);
    if (completed) stored.closed = true;
    const receipt = { requestId: input.requestId, responseId: input.id, completed, duplicate: false, late: !completed && stored.closed };
    stored.keys.set(input.idempotencyKey, receipt); return receipt;
  }
  expire(id: string, now: string): void { const stored = required(this.#requests.get(id), 'NOT_FOUND'); if (Date.parse(now) < Date.parse(stored.request.deadline)) fail('INVALID'); stored.closed = true; }
}

export interface TeamPlan { roles: readonly string[]; join: JoinPolicy; maxDepth: number; budget: number; sequence?: readonly string[]; }
export interface Assignment { id: string; role: string; goalDigest: string; depth: number; reserved: number; status: 'scheduled' | 'completed' | 'late' | 'cancelled'; }
export interface AssignmentResult { assignmentId: string; digest: string; valid: boolean; cost: number; }
export class AgentTeamRuntime {
  readonly #assignments = new Map<string, Assignment>(); readonly #results = new Map<string, AssignmentResult>(); #spent = 0; #closed = false;
  constructor(readonly plan: TeamPlan) { if (!plan.roles.length || plan.maxDepth < 0 || plan.budget < 0 || (plan.join.kind === 'quorum' && (plan.join.count < 1 || plan.join.count > plan.roles.length)) || (plan.sequence !== undefined && (new Set(plan.sequence).size !== plan.sequence.length || plan.sequence.some((role) => !plan.roles.includes(role))))) fail('INVALID'); }
  schedule(input: Omit<Assignment, 'status'>): Assignment {
    const previous = this.plan.sequence === undefined ? undefined : this.plan.sequence.slice(0, this.plan.sequence.indexOf(input.role));
    if (this.#closed || this.#assignments.has(input.id) || !this.plan.roles.includes(input.role) || input.depth > this.plan.maxDepth || input.reserved < 0 || this.#spent + input.reserved > this.plan.budget || previous?.some((role) => ![...this.#assignments.values()].some((assignment) => assignment.role === role && assignment.status === 'completed'))) fail('DENIED');
    const assignment = { ...input, status: 'scheduled' as const }; this.#assignments.set(assignment.id, assignment); this.#spent += assignment.reserved; return assignment;
  }
  complete(result: AssignmentResult): { closed: boolean; late: boolean } {
    const assignment = required(this.#assignments.get(result.assignmentId), 'INVALID'); if (result.cost < 0 || result.cost > assignment.reserved) fail('INVALID'); const prior = this.#results.get(result.assignmentId);
    if (prior !== undefined) { if (!same(prior, result)) fail('CONFLICT'); return { closed: this.#closed, late: assignment.status === 'late' }; }
    this.#results.set(result.assignmentId, result); const valid = [...this.#results.values()].filter((candidate) => candidate.valid).length;
    const closed = this.plan.join.kind === 'first-valid' ? valid >= 1 : this.plan.join.kind === 'quorum' ? valid >= this.plan.join.count : valid >= this.plan.roles.length;
    const late = this.#closed; assignment.status = late ? 'late' : 'completed'; if (closed) this.#closed = true; return { closed: this.#closed, late };
  }
  cancelOutstanding(): Assignment[] { return [...this.#assignments.values()].map((assignment) => assignment.status === 'scheduled' ? Object.assign(assignment, { status: 'cancelled' as const }) : assignment); }
}

export type Disposition = 'adopt' | 'cancel' | 'compensate' | 'await-reconcile' | 'retain-read-only';
export class RecoveryRuntime {
  readonly #paused = new Set<string>(); readonly #dispositions = new Map<string, Disposition>();
  pause(caseId: string): void { this.#paused.add(caseId); }
  resume(caseId: string, dependenciesCurrent: boolean): void { if (!this.#paused.has(caseId) || !dependenciesCurrent) fail('STALE'); this.#paused.delete(caseId); }
  assertSchedulable(caseId: string): void { if (this.#paused.has(caseId)) fail('DENIED'); }
  supersede(items: readonly string[], dispositions: Readonly<Record<string, Disposition>>): void { for (const item of items) this.#dispositions.set(item, required(dispositions[item], 'INVALID')); }
  disposition(item: string): Disposition { return this.#dispositions.get(item) ?? fail('NOT_FOUND'); }
}

export interface EffectIntent { id: string; tenantId: TenantId; caseId: string; generation: number; version: number; idempotencyKey: string; payloadDigest: string; approvalId: string; }
export interface EffectIntentReceipt { intent: EffectIntent; duplicate: boolean; }
export class EffectIntentRuntime {
  readonly #intents = new Map<string, EffectIntent>();
  async record(input: Omit<EffectIntent, 'tenantId' | 'payloadDigest'> & { tenantId: string; payload: unknown }, current: { tenantId: TenantId; generation: number; version: number; authority: 'allow' }, consumeExactApproval: () => void): Promise<EffectIntentReceipt> {
    const tenant = tenantId(input.tenantId); const payloadDigest = await digest(input.payload); const key = `${tenant}\u0000${input.caseId}\u0000${input.idempotencyKey}`; const prior = this.#intents.get(key);
    if (prior !== undefined) { if (prior.payloadDigest !== payloadDigest || prior.id !== input.id) fail('CONFLICT'); return { intent: prior, duplicate: true }; }
    if (current.tenantId !== tenant || current.generation !== input.generation || current.version !== input.version) fail('DENIED');
    consumeExactApproval(); // The write immediately follows this exact approval fence; no provider is reachable here.
    const intent: EffectIntent = { id: input.id, tenantId: tenant, caseId: input.caseId, generation: input.generation, version: input.version, idempotencyKey: input.idempotencyKey, payloadDigest, approvalId: input.approvalId };
    this.#intents.set(key, intent); return { intent, duplicate: false };
  }
}
