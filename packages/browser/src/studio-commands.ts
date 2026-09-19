import type { ExecutionContext } from '../../identity/src/index.js';
import { validateStudioDraft, type StudioDraft } from '../../lifecycle/src/studio.js';
import type { CommandReceipt, StudioStore } from '../../lifecycle/src/studio-sql.js';
import type { BrowserCommand, BrowserCommandHandler } from './index.js';

export type StudioCommandName = 'studio.create-draft' | 'studio.save-draft' | 'studio.run-checks' | 'studio.simulate' | 'studio.evaluate' | 'studio.submit' | 'lifecycle.review' | 'lifecycle.sign' | 'lifecycle.publish';
export interface StudioAuthority { assert(context: ExecutionContext, action: StudioCommandName, objectId?: string): Promise<void>; }
export interface StudioCommandOperations { runChecks(command: BrowserCommand, id: string): Promise<CommandReceipt>; simulate(command: BrowserCommand, id: string, fixtureId: string): Promise<CommandReceipt>; evaluate(command: BrowserCommand, id: string, suiteId: string): Promise<CommandReceipt>; submit(command: BrowserCommand, id: string): Promise<CommandReceipt>; review(command: BrowserCommand, id: string, decision: 'approve' | 'reject', reason: string): Promise<CommandReceipt>; sign(command: BrowserCommand, id: string): Promise<CommandReceipt>; publish(command: BrowserCommand, id: string, visibility: 'tenant' | 'catalog'): Promise<CommandReceipt>; }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
const args = (command: BrowserCommand): Record<string, unknown> => { const value = command.envelope.payload['arguments']; if (value === null || Array.isArray(value) || typeof value !== 'object') fail('INVALID'); return value as Record<string, unknown>; };
const exact = (value: Record<string, unknown>, keys: readonly string[]): void => { if (Object.keys(value).some((key) => !keys.includes(key))) fail('INVALID'); };
const id = (value: unknown): string => typeof value === 'string' && uuid.test(value) ? value : fail('INVALID');
const text = (value: unknown): string => typeof value === 'string' && value.length > 0 ? value : fail('INVALID');
const draft = (value: unknown): StudioDraft => {
  if (value === null || Array.isArray(value) || typeof value !== 'object') fail('INVALID'); const candidate = value as StudioDraft;
  if (!Array.isArray(candidate.agents) || !Array.isArray(candidate.allowedCapabilities) || !Array.isArray(candidate.evaluations) || !Array.isArray(candidate.dependencies) || !candidate.team || !Array.isArray(candidate.team.members) || !Array.isArray(candidate.team.delegation) || !candidate.workflow || !Array.isArray(candidate.workflow.stages) || !candidate.package || !Array.isArray(candidate.package.bindings)) fail('INVALID');
  if (validateStudioDraft(candidate).length) fail('INVALID'); return candidate;
};
const receipt = (command: BrowserCommand, value: { id: string; revision: number; state: CommandReceipt['state']; digest: string }, evidenceIds: readonly string[] = []): CommandReceipt => ({ commandId: command.idempotencyKey, objectId: value.id, revision: value.revision, state: value.state, digest: value.digest, evidenceIds: Object.freeze([...evidenceIds]) });

/** Named, fail-closed commands. Authority is injected from a trusted server policy, never browser claims. */
export class StudioCommandRegistry {
  constructor(private readonly store: StudioStore, private readonly authority: StudioAuthority, private readonly operations: StudioCommandOperations) {}
  handlers(): Readonly<Record<StudioCommandName, BrowserCommandHandler>> {
    return Object.freeze({
      'studio.create-draft': (command) => this.create(command), 'studio.save-draft': (command) => this.save(command), 'studio.run-checks': (command) => this.run(command, 'checks'), 'studio.simulate': (command) => this.run(command, 'simulation'), 'studio.evaluate': (command) => this.run(command, 'evaluation'), 'studio.submit': (command) => this.submit(command), 'lifecycle.review': (command) => this.review(command), 'lifecycle.sign': (command) => this.sign(command), 'lifecycle.publish': (command) => this.publish(command),
    });
  }
  private async create(command: BrowserCommand): Promise<CommandReceipt> { const value = args(command); exact(value, ['id', 'draft']); const objectId = id(value['id']); await this.authority.assert(command.context, 'studio.create-draft'); const saved = await this.store.create(command.context, objectId, draft(value['draft'])); return this.store.rememberCommand(command.tenantId, command.idempotencyKey, command.digest, receipt(command, saved)); }
  private async save(command: BrowserCommand): Promise<CommandReceipt> { const value = args(command); exact(value, ['id', 'draft']); const objectId = id(value['id']); await this.authority.assert(command.context, 'studio.save-draft', objectId); const saved = await this.store.save(command.context, objectId, command.expectedVersion, draft(value['draft']), command.idempotencyKey); return receipt(command, saved); }
  private async run(command: BrowserCommand, kind: 'checks' | 'simulation' | 'evaluation'): Promise<CommandReceipt> { const value = args(command); exact(value, kind === 'simulation' ? ['id', 'fixtureId'] : kind === 'evaluation' ? ['id', 'suiteId'] : ['id']); const objectId = id(value['id']); const action = kind === 'checks' ? 'studio.run-checks' : kind === 'simulation' ? 'studio.simulate' : 'studio.evaluate'; await this.authority.assert(command.context, action, objectId); return kind === 'checks' ? this.operations.runChecks(command, objectId) : kind === 'simulation' ? this.operations.simulate(command, objectId, text(value['fixtureId'])) : this.operations.evaluate(command, objectId, text(value['suiteId'])); }
  private async submit(command: BrowserCommand): Promise<CommandReceipt> { const value = args(command); exact(value, ['id']); const objectId = id(value['id']); await this.authority.assert(command.context, 'studio.submit', objectId); return this.operations.submit(command, objectId); }
  private async review(command: BrowserCommand): Promise<CommandReceipt> { const value = args(command); exact(value, ['id', 'decision', 'reason']); const objectId = id(value['id']); const decision: 'approve' | 'reject' = value['decision'] === 'approve' || value['decision'] === 'reject' ? value['decision'] : fail('INVALID'); await this.authority.assert(command.context, 'lifecycle.review', objectId); return this.operations.review(command, objectId, decision, text(value['reason'])); }
  private async sign(command: BrowserCommand): Promise<CommandReceipt> { const value = args(command); exact(value, ['id']); const objectId = id(value['id']); await this.authority.assert(command.context, 'lifecycle.sign', objectId); return this.operations.sign(command, objectId); }
  private async publish(command: BrowserCommand): Promise<CommandReceipt> { const value = args(command); exact(value, ['id', 'visibility']); const objectId = id(value['id']); const visibility: 'tenant' | 'catalog' = value['visibility'] === 'tenant' || value['visibility'] === 'catalog' ? value['visibility'] : fail('INVALID'); await this.authority.assert(command.context, 'lifecycle.publish', objectId); return this.operations.publish(command, objectId, visibility); }
}
