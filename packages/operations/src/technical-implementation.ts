import { digest, tenantId, type TenantId } from '../../contracts/src/index.js';
import { InMemoryCaseWorkflow, InterventionRuntime, type CaseCommand } from '../../case/src/index.js';
import { CapabilityGateway, CapabilityRegistry, ProviderInstallationManager, signRelease } from '../../gateway/src/index.js';
import { SolutionLifecycle, type Activation } from '../../lifecycle/src/index.js';
import { EvaluationLedger, ProvenanceGraph } from '../../memory/src/index.js';
import type { BrowserCommandHandler } from '../../browser/src/index.js';

export const TECHNICAL_SEED_VERSION = '1.0.0';
export const TECHNICAL_TENANTS = Object.freeze(['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'] as const);
export type EvidenceLabel = 'fixture' | 'simulated-failure';
export interface TechnicalRunManifest { demoRunId: string; tenantId: TenantId; packageDigest: string; activationDigest: string; outcome: 'succeeded' | 'recovered'; label: EvidenceLabel; steps: readonly { name: string; label: EvidenceLabel; digest: string }[]; effects: readonly { capability: string; outcome: string; reconciliation: string }[]; digest: string; }
export interface TechnicalReadiness { seedVersion: string; tenants: readonly { tenantId: TenantId; activation: Activation; epochs: Readonly<Record<string, number>> }[]; digest: string; }
export interface ResetReport { state: 'complete' | 'resume-required' | 'blocked'; residual: readonly string[]; retainedAudit: readonly string[]; digest: string; }
export class TechnicalImplementationError extends Error { constructor(public readonly code: 'CONFLICT' | 'DENIED' | 'NOT_READY' | 'STALE') { super('Technical Implementation request was not accepted.'); this.name = 'TechnicalImplementationError'; } }
const fail = (code: TechnicalImplementationError['code']): never => { throw new TechnicalImplementationError(code); };
const now = '2099-01-01T00:00:00.000Z';
const command = (tenant: string, name: CaseCommand['name'], version: number): CaseCommand => ({ id: `technical-${name}-${String(version)}`, tenantId: tenantId(tenant), name, expectedGeneration: 1, expectedVersion: version, idempotencyKey: `technical-${name}-${String(version)}`, argumentDigest: 'a'.repeat(64), authority: 'allow' });

/** The signed fixture uses the shared lifecycle seam; it is intentionally not a solution-specific runtime. */
export async function technicalImplementationFixture(tenant: string): Promise<{ activation: Activation }> {
  const lifecycle = new SolutionLifecycle();
  const draft = lifecycle.author({ id: 'technical-implementation', version: TECHNICAL_SEED_VERSION, author: 'fixture-author', artifacts: [{ id: 'technical-workflow', version: TECHNICAL_SEED_VERSION, digest: 'a'.repeat(64), kind: 'workflow', content: { case: 'technical-implementation', team: ['discovery', 'data', 'delivery'], joins: ['parallel-discovery', 'handoff'], budgets: { effects: 3 }, interventions: ['missing-information'], memory: 'governed', evaluation: 'required', capabilities: ['sql.validate', 'blob.write', 'boards.create'] } }], dependencies: [], bindings: ['sql-fixture', 'blob-fixture', 'boards-fixture'], overlayPaths: ['/budget'] });
  const resolved = await lifecycle.resolve(draft.id, draft.version, { '/budget': 3 });
  await lifecycle.validate(resolved.digest, { hardPassed: true, evidenceCurrent: true, comparable: true, liveCertified: true, subjectDigest: resolved.digest });
  const publication = await lifecycle.publish({ packageDigest: resolved.digest, approver: 'fixture-approver', signer: 'fixture-signer', publisher: 'fixture-publisher', keyId: 'fixture-key', tenantIds: [tenant] });
  const readiness = await lifecycle.install({ id: `technical-installation-${tenant}`, tenantId: tenant, packageDigest: publication.digest, epochs: { policy: 1, sql: 1, blob: 1, boards: 1, credential: 1 }, checksCurrent: true });
  return { activation: lifecycle.activate({ idempotencyKey: `technical-activate-${tenant}`, id: `technical-activation-${tenant}`, tenantId: tenant, installationId: `technical-installation-${tenant}`, readinessDigest: readiness.digest, expectedVersion: 1 }) };
}

/** Deterministic, fixture-only M8 runner. It composes public package APIs and keeps no provider credentials. */
export class TechnicalImplementationRuntime {
  #bootstrapped = false; #seeded: TechnicalReadiness | undefined; #generated = new Set<string>(); #resetInterrupted = false;

  bootstrap(input: { version: string; dependenciesPresent?: boolean; unmanaged?: readonly string[] } = { version: TECHNICAL_SEED_VERSION }): void {
    if (input.version !== TECHNICAL_SEED_VERSION) fail('STALE');
    if (input.dependenciesPresent === false) fail('NOT_READY');
    if ((input.unmanaged?.length ?? 0) > 0) fail('CONFLICT');
    this.#bootstrapped = true;
  }

  async seed(version = TECHNICAL_SEED_VERSION): Promise<TechnicalReadiness> {
    if (!this.#bootstrapped) fail('NOT_READY');
    if (version !== TECHNICAL_SEED_VERSION) fail('STALE');
    if (this.#seeded !== undefined) return this.#seeded;
    const tenants = await Promise.all(TECHNICAL_TENANTS.map(async (id) => ({ tenantId: tenantId(id), activation: (await technicalImplementationFixture(id)).activation, epochs: Object.freeze({ policy: 1, sql: 1, blob: 1, boards: 1, credential: 1 }) })));
    const base = { seedVersion: version, tenants: Object.freeze(tenants) };
    this.#seeded = Object.freeze({ ...base, digest: await digest({ ...base, tenants: tenants.map((item) => ({ ...item, tenantId: String(item.tenantId) })) }) });
    return this.#seeded;
  }

  ready(): TechnicalReadiness { return this.#seeded ?? fail('NOT_READY'); }

  async success(tenant: string = TECHNICAL_TENANTS[0]): Promise<TechnicalRunManifest> {
    const readiness = this.ready(); const scoped = tenantId(tenant);
    const activation = readiness.tenants.find((item) => item.tenantId === scoped)?.activation ?? fail('DENIED');
    const workflow = new InMemoryCaseWorkflow(); workflow.start({ id: 'technical-case', tenantId: String(scoped), packagePin: { name: 'technical-implementation', version: TECHNICAL_SEED_VERSION, digest: activation.packageDigest } });
    await workflow.command('technical-case', command(String(scoped), 'submit', 0)); await workflow.command('technical-case', command(String(scoped), 'start', 1));
    const intervention = new InterventionRuntime(); await workflow.command('technical-case', command(String(scoped), 'request-information', 2));
    intervention.open({ id: 'technical-information', tenantId: scoped, caseId: 'technical-case', generation: 1, version: 3, type: 'information-request', responders: ['customer'], join: { kind: 'first-valid' }, deadline: '2099-01-02T00:00:00.000Z', argumentDigest: 'b'.repeat(64) });
    intervention.respond({ id: 'technical-information-response', requestId: 'technical-information', responderId: 'customer', idempotencyKey: 'technical-information-response', content: { endpoint: 'fixture' }, contentDigest: 'c'.repeat(64), authorized: true, at: now }, { tenantId: scoped, generation: 1, version: 3 });
    await workflow.command('technical-case', command(String(scoped), 'provide-information', 3)); await workflow.command('technical-case', command(String(scoped), 'start', 4));
    const effects = await this.effects(String(scoped)); await workflow.command('technical-case', command(String(scoped), 'succeed', 5));
    const graph = new ProvenanceGraph(); graph.add({ id: 'technical-provenance', tenantId: String(scoped), scope: { kind: 'case', tenantId: String(scoped), caseId: 'technical-case', generation: 1 }, purpose: 'technical-handoff', classification: 'restricted-operational', legalBasis: 'fixture-agreement', retention: 'fixture', locations: ['fixture://technical'], transformation: 'deterministic', digest: 'd'.repeat(64) });
    const ledger = new EvaluationLedger(() => now); await ledger.append({ id: 'technical-ledger', tenantId: String(scoped), kind: 'deterministic-check', subject: { id: 'technical-case', version: '1', digest: await workflow.replayDigest('technical-case') }, dataset: { digest: 'e'.repeat(64), rule: 'fixture-complete' }, rubric: 'technical', evaluator: 'fixture', environment: 'local', aggregation: 'all', evidence: [{ id: graph.record('technical-provenance').id, digest: 'd'.repeat(64), classification: 'restricted-operational' }], score: 1, confidence: 1, evidenceCurrent: true, conflicting: false });
    this.#generated = new Set(['technical-case', 'sql-validation', 'blob-handoff', 'boards-work-item', 'temporary-credential']);
    const steps = await Promise.all(['accepted-agreement', 'parallel-discovery', 'information-intervention', 'revised-plan-r1-r2', 'production-handoff'].map(async (name) => ({ name, label: 'fixture' as const, digest: await digest({ name, activation: activation.packageDigest }) })));
    const base = { demoRunId: 'technical-fixture-run', tenantId: scoped, packageDigest: activation.packageDigest, activationDigest: activation.readinessDigest, outcome: 'succeeded' as const, label: 'fixture' as const, steps: Object.freeze(steps), effects: Object.freeze(effects) };
    return Object.freeze({ ...base, digest: await digest({ ...base, tenantId: String(scoped) }) });
  }

  async negatives(tenant = TECHNICAL_TENANTS[0]): Promise<TechnicalRunManifest> {
    const success = await this.success(tenant); const scoped = tenantId(tenant);
    const labels = ['cross-tenant-denial', 'stale-self-approval', 'budget-throttle', 'conflicting-idempotency', 'possible-send-reconciled', 'workflow-replay'];
    const steps = await Promise.all(labels.map(async (name) => ({ name, label: 'simulated-failure' as const, digest: await digest({ name, tenant: String(scoped) }) })));
    const base = { demoRunId: success.demoRunId, tenantId: scoped, packageDigest: success.packageDigest, activationDigest: success.activationDigest, outcome: 'recovered' as const, label: 'simulated-failure' as const, steps: Object.freeze(steps), effects: success.effects };
    return Object.freeze({ ...base, digest: await digest({ ...base, tenantId: String(scoped) }) });
  }

  async reset(input: { held?: boolean; foreign?: boolean; interrupt?: boolean; resume?: boolean } = {}): Promise<ResetReport> {
    this.ready();
    if (input.held || input.foreign) return this.report('blocked', [...(input.held ? ['held-evidence'] : []), ...(input.foreign ? ['foreign-object'] : [])]);
    if (input.interrupt) { this.#resetInterrupted = true; return this.report('resume-required', [...this.#generated]); }
    if (this.#resetInterrupted && !input.resume) return this.report('resume-required', [...this.#generated]);
    this.#resetInterrupted = false; this.#generated.clear(); return this.report('complete', []);
  }

  async repeat(): Promise<{ first: TechnicalRunManifest; second: TechnicalRunManifest; reset: ResetReport; equal: boolean }> {
    const first = await this.success(); await this.reset(); const second = await this.success(); const reset = await this.reset();
    return Object.freeze({ first, second, reset, equal: first.digest === second.digest });
  }

  /** Registered browser.v1 owners; the transport remains responsible for session and Tenant proof. */
  browserCommands(): Readonly<Record<string, BrowserCommandHandler>> {
    return Object.freeze({
      'case.run': async (command) => {
        const args = command.envelope.payload['arguments'];
        if (args === null || Array.isArray(args) || typeof args !== 'object' || Object.keys(args).some((key) => key !== 'seedVersion') || (args as Record<string, unknown>)['seedVersion'] !== TECHNICAL_SEED_VERSION) fail('STALE');
        const run = await this.success(command.tenantId);
        return { caseId: 'technical-case', correlationId: command.correlationId, fixtureLabel: run.label, runDigest: run.digest };
      },
      'operations.reset': async (command) => {
        const args = command.envelope.payload['arguments'];
        if (args === null || Array.isArray(args) || typeof args !== 'object' || Object.keys(args).some((key) => key !== 'resume') || ((args as Record<string, unknown>)['resume'] !== undefined && typeof (args as Record<string, unknown>)['resume'] !== 'boolean')) fail('DENIED');
        const report = await this.reset({ resume: (args as Record<string, unknown>)['resume'] === true });
        return { fixtureLabel: 'fixture', resetDigest: report.digest, state: report.state };
      },
    });
  }

  private async effects(tenant: string): Promise<readonly { capability: string; outcome: string; reconciliation: string }[]> {
    const registry = new CapabilityRegistry({ fixture: 'fixture-signing-key' });
    for (const name of ['sql.validate', 'blob.write', 'boards.create']) registry.registerDefinition({ name, version: TECHNICAL_SEED_VERSION, inputKeys: ['id'], outputKeys: ['receipt'] });
    const unsigned = { id: 'technical-fixture-release', provider: 'fixture', version: TECHNICAL_SEED_VERSION, definitions: ['sql.validate', 'blob.write', 'boards.create'] }; const signed = await signRelease('fixture', 'fixture-signing-key', unsigned); await registry.registerRelease({ ...unsigned, ...signed });
    const installations = new ProviderInstallationManager(registry, () => now); installations.install({ id: 'technical-provider', tenantId: tenant, releaseId: unsigned.id, accountId: 'fixture-account', callbackId: 'fixture-callback' }); installations.validate('technical-provider', 1, { account: true, callback: true, health: true, schema: true, signature: true });
    const gateway = new CapabilityGateway(installations, { invoke: (input) => ({ outcome: 'succeeded', output: { receipt: input.effectId }, providerRef: `fixture://${input.effectId}` }) }, { now: () => now });
    return Promise.all(['sql.validate', 'blob.write', 'boards.create'].map(async (capability, index) => { const receipt = await gateway.invoke({ id: `technical-${capability}`, tenantId: tenant, effectId: `technical-effect-${String(index)}`, attemptId: `technical-attempt-${String(index)}`, caseId: 'technical-case', generation: 1, idempotencyKey: `technical-key-${String(index)}`, capability, installationId: 'technical-provider', accountId: 'fixture-account', resource: `fixture-${String(index)}`, operation: capability, arguments: { id: String(index) }, deadline: '2099-01-02T00:00:00.000Z', authorityCurrent: true, approvalCurrent: true, budgetRemaining: 1 }); return { capability, outcome: receipt.outcome, reconciliation: receipt.reconciliationRequired ? 'required' : 'resolved' }; }));
  }

  private async report(state: ResetReport['state'], residual: readonly string[]): Promise<ResetReport> { const base = { state, residual: Object.freeze([...residual].sort()), retainedAudit: Object.freeze(['technical-audit']) }; return Object.freeze({ ...base, digest: await digest(base) }); }
}

export interface InfrastructureResource { id: string; type: 'Microsoft.Storage/storageAccounts' | 'Microsoft.Sql/servers/databases' | 'Microsoft.App/containerApps' | 'Microsoft.Web/sites' | 'Microsoft.OperationalInsights/workspaces'; sku: string; tags: Readonly<Record<string, string>>; rbacScope: 'resource-group' | 'subscription'; networkScope: 'private' | 'public'; }
export interface InfrastructurePlan { environment: string; region: string; resourceGroup: string; lease: { id: string; expiresAt: string; owner: string }; resources: readonly InfrastructureResource[]; estimatedCostUsd: number; budgetUsd: number; destructiveTargets?: readonly string[]; }
export interface InfrastructurePlanResult { allowed: boolean; decisions: readonly string[]; inventory: readonly string[]; digest: string; }
const allowedTypes = new Set<InfrastructureResource['type']>(['Microsoft.Storage/storageAccounts', 'Microsoft.Sql/servers/databases', 'Microsoft.App/containerApps', 'Microsoft.Web/sites', 'Microsoft.OperationalInsights/workspaces']);
const allowedSkus = new Set(['Standard_LRS', 'Basic', 'S0', 'Consumption', 'PerGB2018']);
/** Policy-only IaC seam. It validates exact plans before any deployment adapter is called. */
export async function validateInfrastructurePlan(plan: InfrastructurePlan): Promise<InfrastructurePlanResult> {
  const decisions: string[] = [];
  if (!['centralindia', 'eastus'].includes(plan.region)) decisions.push('REGION_DENIED');
  if (!plan.environment || !plan.resourceGroup) decisions.push('SCOPE_DENIED');
  if (!plan.lease.id || !plan.lease.owner || Date.parse(plan.lease.expiresAt) <= Date.parse(now)) decisions.push('LEASE_DENIED');
  if (!Number.isFinite(plan.estimatedCostUsd) || plan.estimatedCostUsd > plan.budgetUsd) decisions.push('COST_DENIED');
  if (!plan.resources.length || new Set(plan.resources.map((item) => item.id)).size !== plan.resources.length) decisions.push('INVENTORY_DENIED');
  for (const resource of plan.resources) { if (!allowedTypes.has(resource.type)) decisions.push(`TYPE_DENIED:${resource.id}`); if (!allowedSkus.has(resource.sku)) decisions.push(`SKU_DENIED:${resource.id}`); if (resource.rbacScope !== 'resource-group' || resource.networkScope !== 'private') decisions.push(`SCOPE_DENIED:${resource.id}`); if (resource.tags['owner'] !== plan.lease.owner || resource.tags['lease'] !== plan.lease.id || resource.tags['environment'] !== plan.environment) decisions.push(`TAG_DENIED:${resource.id}`); }
  if ((plan.destructiveTargets?.some((target) => !plan.resources.some((resource) => resource.id === target)) ?? false)) decisions.push('DESTRUCTIVE_TARGET_DENIED');
  const base = { allowed: decisions.length === 0, decisions: Object.freeze(decisions.sort()), inventory: Object.freeze(plan.resources.map((item) => item.id).sort()) };
  return Object.freeze({ ...base, digest: await digest({ ...base, plan }) });
}
