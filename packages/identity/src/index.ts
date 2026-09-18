import { canonicalJson, digest, tenantId, type TenantId } from '../../contracts/src/index.js';
import sql from 'mssql';

export type IdentityErrorCode = 'DENIED' | 'CONFLICT' | 'INVALID' | 'NOT_FOUND' | 'STALE' | 'INDETERMINATE';
export class IdentityError extends Error {
  constructor(public readonly code: IdentityErrorCode) { super('Identity request was not accepted.'); this.name = 'IdentityError'; }
}
const deny = (code: IdentityErrorCode = 'DENIED'): never => { throw new IdentityError(code); };

export type TenantStatus = 'provisioning' | 'active' | 'suspended' | 'deleting' | 'deleted';
export interface Tenant { id: TenantId; status: TenantStatus; version: number; epoch: number; legalHold: boolean; }
export interface User { id: string; issuer: string; subject: string; disabled: boolean; }
export type MembershipStatus = 'pending' | 'current' | 'suspended' | 'revoked';
export interface Membership { tenantId: TenantId; userId: string; status: MembershipStatus; profiles: readonly string[]; version: number; epoch: number; }
export interface ApprovalBinding { caseId: string; generation: number; action: string; target: string; argumentDigest: string; requiredProfile: string; risk: 'R2' | 'R3'; }
export interface Approval extends ApprovalBinding { id: string; tenantId: TenantId; requesterId: string; approverId: string; expiresAt: string; consumed: boolean; revoked: boolean; }
export type IngressMode = 'interactive' | 'workload' | 'worker' | 'webhook';
export interface Proof { mode: IngressMode; issuer: string; subject: string; audience: string; expiresAt: string; tokenUse: string; sessionId?: string; nonce?: string; origin?: string; replayKey?: string; }
export interface ExecutionContext { mode: IngressMode; userId: string; tenantId: TenantId; expiresAt: string; membershipEpoch: number; tenantEpoch: number; sessionId?: string; }
export interface IdentityReadStore {
  authenticate(proof: Proof, selectedTenant: string, audience: string, now?: string): ExecutionContext | Promise<ExecutionContext>;
  membershipsForProof(proof: Proof): readonly Pick<Membership, 'tenantId' | 'profiles' | 'epoch'>[] | Promise<readonly Pick<Membership, 'tenantId' | 'profiles' | 'epoch'>[]>;
}

export class IdentityStore {
  #tenants = new Map<string, Tenant>();
  #users = new Map<string, User>();
  #subjectUsers = new Map<string, string>();
  #memberships = new Map<string, Membership>();
  #approvals = new Map<string, Approval>();
  #replays = new Set<string>();

  provision(id: string): Tenant {
    const tenant = tenantId(id); if (this.#tenants.has(tenant)) deny('CONFLICT');
    const created: Tenant = { id: tenant, status: 'provisioning', version: 1, epoch: 1, legalHold: false };
    this.#tenants.set(tenant, created); return created;
  }
  transition(id: string, expectedVersion: number, action: 'activate' | 'suspend' | 'recover' | 'delete' | 'complete-delete'): Tenant {
    const current = this.tenant(id); if (current.version !== expectedVersion) deny('STALE');
    const next: Record<TenantStatus, Partial<Record<typeof action, TenantStatus>>> = {
      provisioning: { activate: 'active' }, active: { suspend: 'suspended', delete: 'deleting' }, suspended: { recover: 'active', delete: 'deleting' }, deleting: { 'complete-delete': 'deleted' }, deleted: {},
    };
    const status = next[current.status][action]; if (status === undefined || (action === 'complete-delete' && current.legalHold)) throw new IdentityError('CONFLICT');
    const updated = { ...current, status, version: current.version + 1, epoch: current.epoch + 1 };
    this.#tenants.set(updated.id, updated); return updated;
  }
  setLegalHold(id: string, expectedVersion: number, legalHold: boolean): Tenant {
    const current = this.tenant(id); if (current.version !== expectedVersion || current.status === 'deleted') deny('STALE');
    const updated = { ...current, legalHold, version: current.version + 1, epoch: current.epoch + 1 }; this.#tenants.set(updated.id, updated); return updated;
  }
  mapUser(issuer: string, subject: string, userId: string): User {
    if (!issuer || !subject || !userId) deny('INVALID'); const key = `${issuer}\u0000${subject}`; const mapped = this.#subjectUsers.get(key);
    if (mapped !== undefined && mapped !== userId) deny('CONFLICT'); const user = this.#users.get(userId) ?? { id: userId, issuer, subject, disabled: false };
    if (user.issuer !== issuer || user.subject !== subject) deny('CONFLICT'); this.#subjectUsers.set(key, userId); this.#users.set(userId, user); return user;
  }
  disableUser(userId: string): void { const user = this.#users.get(userId); if (user === undefined) throw new IdentityError('NOT_FOUND'); this.#users.set(userId, { ...user, disabled: true }); }
  membership(id: string, userId: string, profiles: readonly string[] = []): Membership {
    const tenant = this.tenant(id); const user = this.#users.get(userId); if (user === undefined || tenant.status === 'deleted') deny(); const key = this.key(tenant.id, userId);
    if (this.#memberships.has(key)) deny('CONFLICT'); const membership: Membership = { tenantId: tenant.id, userId, status: 'pending', profiles: [...profiles], version: 1, epoch: 1 };
    this.#memberships.set(key, membership); return membership;
  }
  setMembership(id: string, userId: string, expectedVersion: number, status: Exclude<MembershipStatus, 'pending'>): Membership {
    const key = this.key(tenantId(id), userId); const current = this.#memberships.get(key); if (current === undefined) throw new IdentityError('DENIED'); if (current.version !== expectedVersion || current.status === 'revoked') deny('STALE');
    const updated = { ...current, status, version: current.version + 1, epoch: current.epoch + 1 }; this.#memberships.set(key, updated); return updated;
  }
  requestApproval(id: string, approval: Omit<Approval, 'tenantId' | 'consumed' | 'revoked'>): Approval {
    const tenant = this.tenant(id); this.currentMembership(tenant.id, approval.requesterId); const approver = this.currentMembership(tenant.id, approval.approverId); if (approval.requesterId === approval.approverId || !approver.profiles.includes(approval.requiredProfile)) deny();
    if (this.#approvals.has(approval.id) || Date.parse(approval.expiresAt) <= Date.now()) deny('CONFLICT'); const created = { ...approval, tenantId: tenant.id, consumed: false, revoked: false };
    this.#approvals.set(created.id, created); return created;
  }
  consumeApproval(id: string, approvalId: string, binding: ApprovalBinding, now = new Date().toISOString()): Approval {
    const tenant = this.tenant(id); const approval = this.#approvals.get(approvalId); if (approval === undefined || approval.tenantId !== tenant.id) throw new IdentityError('DENIED');
    this.currentMembership(tenant.id, approval.requesterId); const approver = this.currentMembership(tenant.id, approval.approverId);
    if (approval.consumed || approval.revoked || !approver.profiles.includes(approval.requiredProfile) || Date.parse(approval.expiresAt) <= Date.parse(now) || canonicalJson(this.binding(approval)) !== canonicalJson(binding)) deny('CONFLICT');
    const used = { ...approval, consumed: true }; this.#approvals.set(approvalId, used); return used;
  }
  authenticate(proof: Proof, selectedTenant: string, audience: string, now = new Date().toISOString()): ExecutionContext {
    const expectedTokenUse: Record<IngressMode, string> = { interactive: 'session', workload: 'workload', worker: 'workload', webhook: 'webhook' };
    if (proof.audience !== audience || proof.tokenUse !== expectedTokenUse[proof.mode] || !proof.issuer || !proof.subject || Date.parse(proof.expiresAt) <= Date.parse(now)) throw new IdentityError('DENIED');
    if (proof.mode === 'interactive' && proof.sessionId === undefined) throw new IdentityError('DENIED'); if (proof.mode === 'webhook' && (proof.replayKey === undefined || this.#replays.has(proof.replayKey))) throw new IdentityError('DENIED');
    if (proof.replayKey !== undefined) this.#replays.add(proof.replayKey); const userId = this.#subjectUsers.get(`${proof.issuer}\u0000${proof.subject}`); if (userId === undefined || this.#users.get(userId)?.disabled) throw new IdentityError('DENIED');
    const tenant = this.tenant(selectedTenant); const member = this.currentMembership(tenant.id, userId); if (tenant.status !== 'active') deny();
    return { mode: proof.mode, userId, tenantId: tenant.id, expiresAt: proof.expiresAt, membershipEpoch: member.epoch, tenantEpoch: tenant.epoch, ...(proof.sessionId === undefined ? {} : { sessionId: proof.sessionId }) };
  }
  async evaluateAuthority(request: { context: ExecutionContext; action: string; arguments: unknown; grants: readonly boolean[]; prohibited?: boolean; approval?: { id: string; binding: ApprovalBinding }; now?: string }): Promise<{ outcome: 'allow' | 'deny' | 'approval-required' | 'indeterminate'; digest: string }> {
    const now = request.now ?? new Date().toISOString(); const digestValue = await digest({ action: request.action, arguments: request.arguments });
    try { const tenant = this.tenant(request.context.tenantId); const member = this.currentMembership(tenant.id, request.context.userId); if (tenant.status !== 'active' || Date.parse(request.context.expiresAt) <= Date.parse(now) || tenant.epoch !== request.context.tenantEpoch || member.epoch !== request.context.membershipEpoch || request.prohibited || request.grants.some((grant) => !grant)) return { outcome: 'deny', digest: digestValue };
      if (request.approval !== undefined) this.consumeApproval(tenant.id, request.approval.id, request.approval.binding, now);
      return { outcome: 'allow', digest: digestValue };
    } catch (error) { if (error instanceof IdentityError && error.code === 'CONFLICT' && request.approval !== undefined) return { outcome: 'approval-required', digest: digestValue }; return { outcome: 'deny', digest: digestValue }; }
  }
  async authorizeBeforeCommit<T>(request: Parameters<IdentityStore['evaluateAuthority']>[0], work: () => T | Promise<T>): Promise<T> {
    if ((await this.evaluateAuthority(request)).outcome !== 'allow') deny(); const result = await work(); const recheck = { ...request }; delete recheck.approval; if ((await this.evaluateAuthority(recheck)).outcome !== 'allow') deny('STALE'); return result;
  }
  membershipsForUser(userId: string): readonly Pick<Membership, 'tenantId' | 'profiles' | 'epoch'>[] {
    return [...this.#memberships.values()].filter((membership) => membership.userId === userId && membership.status === 'current' && this.#tenants.get(membership.tenantId)?.status === 'active').map(({ tenantId: id, profiles, epoch }) => ({ tenantId: id, profiles: [...profiles], epoch }));
  }
  membershipsForProof(proof: Proof): readonly Pick<Membership, 'tenantId' | 'profiles' | 'epoch'>[] { return this.membershipsForUser(this.userForExternal(proof.issuer, proof.subject).id); }
  userForExternal(issuer: string, subject: string): User { const userId = this.#subjectUsers.get(`${issuer}\u0000${subject}`); const user = userId === undefined ? undefined : this.#users.get(userId); return user ?? deny('DENIED'); }
  exportManifest(id: string): { tenantId: TenantId; status: TenantStatus; users: number; memberships: number; approvals: number } { const tenant = this.tenant(id); const memberships = [...this.#memberships.values()].filter((membership) => membership.tenantId === tenant.id); return { tenantId: tenant.id, status: tenant.status, users: new Set(memberships.map((membership) => membership.userId)).size, memberships: memberships.length, approvals: [...this.#approvals.values()].filter((approval) => approval.tenantId === tenant.id).length }; }
  tenant(id: string | TenantId): Tenant { const value = this.#tenants.get(tenantId(id)); if (value === undefined) throw new IdentityError('DENIED'); return value; }
  private currentMembership(id: TenantId, userId: string): Membership { const membership = this.#memberships.get(this.key(id, userId)); if (membership === undefined || membership.status !== 'current') throw new IdentityError('DENIED'); return membership; }
  private key(id: TenantId, userId: string): string { return `${id}\u0000${userId}`; }
  private binding(approval: Approval): ApprovalBinding { const { caseId, generation, action, target, argumentDigest, requiredProfile, risk } = approval; return { caseId, generation, action, target, argumentDigest, requiredProfile, risk }; }
}

/** Azure SQL read boundary; writes remain administrator-controlled migrations or provisioning work. */
export class AzureSqlIdentityStore implements IdentityReadStore {
  constructor(private readonly connectionString: string) { if (!connectionString.trim()) throw new Error('Missing AZURE_SQL_CONNECTION_STRING.'); }
  async authenticate(proof: Proof, selectedTenant: string, audience: string, now = new Date().toISOString()): Promise<ExecutionContext> {
    this.validate(proof, audience, now);
    const tenant = tenantId(selectedTenant); const result = await this.call('identity.read_current_session', (request) => request.input('tenant_id', sql.UniqueIdentifier, String(tenant)).input('issuer', sql.NVarChar(512), proof.issuer).input('subject', sql.NVarChar(256), proof.subject));
    const row = result.recordset[0] as { user_id?: string; tenant_epoch?: number; membership_epoch?: number } | undefined;
    const userId = row?.user_id; const tenantEpoch = row?.tenant_epoch; const membershipEpoch = row?.membership_epoch;
    if (!userId || !Number.isSafeInteger(tenantEpoch) || !Number.isSafeInteger(membershipEpoch)) deny();
    return { mode: proof.mode, userId: userId as string, tenantId: tenant, expiresAt: proof.expiresAt, membershipEpoch: membershipEpoch as number, tenantEpoch: tenantEpoch as number, ...(proof.sessionId === undefined ? {} : { sessionId: proof.sessionId }) };
  }
  async membershipsForProof(proof: Proof): Promise<readonly Pick<Membership, 'tenantId' | 'profiles' | 'epoch'>[]> {
    const result = await this.call('identity.list_current_tenants', (request) => request.input('issuer', sql.NVarChar(512), proof.issuer).input('subject', sql.NVarChar(256), proof.subject));
    const memberships = new Map<string, { tenantId: TenantId; profiles: string[]; epoch: number }>();
    for (const row of result.recordset as { tenant_id?: string; membership_epoch?: number; profile_key?: string | null }[]) {
      if (!row.tenant_id || !Number.isSafeInteger(row.membership_epoch)) continue;
      const id = tenantId(row.tenant_id); const existing = memberships.get(String(id));
      if (existing !== undefined) { if (typeof row.profile_key === 'string') existing.profiles.push(row.profile_key); continue; }
      const item = { tenantId: id, profiles: typeof row.profile_key === 'string' ? [row.profile_key] : [], epoch: row.membership_epoch as number };
      memberships.set(String(id), item);
    }
    return [...memberships.values()].map((membership) => ({ ...membership, profiles: [...new Set(membership.profiles)].sort() }));
  }
  private validate(proof: Proof, audience: string, now: string): void {
    const tokenUse: Record<IngressMode, string> = { interactive: 'session', workload: 'workload', worker: 'workload', webhook: 'webhook' };
    if (proof.audience !== audience || proof.tokenUse !== tokenUse[proof.mode] || !proof.issuer || !proof.subject || Date.parse(proof.expiresAt) <= Date.parse(now) || (proof.mode === 'interactive' && proof.sessionId === undefined)) deny();
  }
  private async call(procedure: string, bind: (request: sql.Request) => sql.Request): Promise<sql.IProcedureResult<unknown>> {
    const pool = await new sql.ConnectionPool(this.connectionString).connect();
    try { return await bind(pool.request()).execute(procedure); } finally { await pool.close(); }
  }
}
