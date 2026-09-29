import { AzureSqlIdentityStore, IdentityStore } from '../../identity/src/index.js';
import { BrowserV1Transport, liveClerkSessionAdapter, type BrowserProjection, type ClerkBackend } from './index.js';
import { AzureSqlProjectionStore } from './sql-projections.js';
import { AzureSqlStudioStore } from '../../lifecycle/src/studio-sql.js';
import { AzureSqlWorkflowStore } from '../../workflow/src/sql.js';
import { WorkflowService, type OpenRouterModel, type Scheduler } from '../../workflow/src/service.js';
import { UpstashVectorMemoryPort } from '../../workflow/src/ports.js';
import { OpenRouterConnectionCrypto } from '../../workflow/src/openrouter-connection.js';
import { workflowCommandHandlers } from './workflow-commands.js';
import { digest } from '../../contracts/src/index.js';
import { AppError } from '../../errors/src/app-error.js';
import { report } from '../../errors/src/report.js';

const required = (environment: Readonly<Record<string, string | undefined>>, name: string): string => {
  const value = environment[name]?.trim();
  if (!value) throw new AppError('UNAVAILABLE', { cause: new Error(`Missing ${name}.`) });
  return value;
};

/** Ephemeral local identity data for exercising a real Clerk session against browser.v1. */
export function localBrowserTransport(environment: Readonly<Record<string, string | undefined>>, backend?: ClerkBackend, scheduler?: Scheduler): BrowserV1Transport {
  const issuer = required(environment, 'CLERK_ISSUER');
  const authorizedParties = required(environment, 'CLERK_AUTHORIZED_PARTIES').split(',').map((origin) => origin.trim()).filter(Boolean);
  if (authorizedParties.length === 0) throw new Error('Missing CLERK_AUTHORIZED_PARTIES.');
  const connectionString = environment['AZURE_SQL_CONNECTION_STRING']?.trim();
  const identity = connectionString ? new AzureSqlIdentityStore(connectionString) : fixtureIdentity(
    issuer,
    required(environment, 'PLATFORM_LOCAL_CLERK_SUBJECT'),
    [...new Set(required(environment, 'PLATFORM_LOCAL_TENANTS').split(',').map((tenant) => tenant.trim()).filter(Boolean))],
  );
  const clerk = liveClerkSessionAdapter(environment, backend);
  const projectionStore = connectionString ? new AzureSqlProjectionStore(connectionString) : undefined;
  const projections = projectionStore === undefined ? fixtureProjection : (input: BrowserProjection) => projectionStore.read(input);
  const workflowStore = connectionString ? new AzureSqlWorkflowStore(connectionString) : undefined;
  const providers = [environment['AZURE_OPENAI_ENDPOINT'] && environment['AZURE_OPENAI_API_KEY'] ? 'azure-openai' : undefined, environment['WORKFLOW_OPENROUTER_WRAPPING_KEY'] && environment['WORKFLOW_OPENROUTER_WRAPPING_KEY_VERSION'] ? 'openrouter' : undefined].filter((provider): provider is string => provider !== undefined);
  const allowedMcpHosts = new Set((environment['WORKFLOW_MCP_ALLOWED_HOSTS'] ?? '').split(',').map((host) => host.trim()).filter(Boolean));
  const connectorReady = (installation: { id: string; route: string; endpoint?: string; tokenHash?: string }): boolean => {
    if (installation.route === 'private') return Boolean(installation.tokenHash);
    try { return Boolean(installation.endpoint && allowedMcpHosts.has(new URL(installation.endpoint).hostname) && environment[`WORKFLOW_MCP_CREDENTIAL_${installation.id.replaceAll('-', '').toUpperCase()}`]); } catch { return false; }
  };
  const memory = new UpstashVectorMemoryPort(environment);
  const crypto = providers.includes('openrouter') ? OpenRouterConnectionCrypto.fromEnvironment(environment) : undefined;
  const structuredModels = new Set((environment['WORKFLOW_OPENROUTER_STRUCTURED_OUTPUT_MODELS'] ?? '').split(',').map((model) => model.trim()).filter(Boolean));
  const openRouterModels: readonly OpenRouterModel[] = [...new Set((environment['WORKFLOW_OPENROUTER_MODELS'] ?? '').split(',').map((model) => model.trim()).filter(Boolean))].map((id) => ({ id, structuredOutput: structuredModels.has(id) }));
  const workflow = connectionString && workflowStore ? new WorkflowService(new AzureSqlStudioStore(connectionString), workflowStore, scheduler, [], providers, connectorReady, (tenantId) => memory.enabled(tenantId) ? memory.readiness : 'disabled', memory, crypto ? { crypto, verify: async (key) => (await fetch('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) })).ok } : undefined, openRouterModels) : undefined;
  const commands = workflow && workflowStore ? workflowCommandHandlers(new AzureSqlStudioStore(connectionString!), workflowStore, workflow) : undefined;
  const read = workflow ? (input: BrowserProjection) => input.collection.startsWith('workflow-') || input.collection === 'connector-installations' || input.collection.startsWith('openrouter-') ? workflow.projection(input.context, input.collection, input.id, { ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }), ...(input.cursor === undefined ? {} : { cursor: input.cursor }) }) : projections(input) : projections;
  return new BrowserV1Transport({ allowedOrigins: authorizedParties, onError: report, clerk, identity, projections: read, ...(commands ? { commands } : {}), ...(workflow ? { connections: async (input) => { if (!crypto) throw new AppError('FEATURE_NOT_READY'); const result = await workflow.openRouterConnection(input.context, input.action, input.expectedVersion, input.idempotencyKey, await digest({ action: input.action, key: input.key ? crypto.digest(String(input.context.tenantId), input.key) : undefined }), input.key); return { commandId: input.idempotencyKey, objectId: '00000000-0000-5000-8000-000000000002', revision: result.version, state: result.state, digest: 'redacted', evidenceIds: [] }; } } : {}) });
}

function fixtureIdentity(issuer: string, subject: string, tenantIds: readonly string[]): IdentityStore {
  if (tenantIds.length === 0) throw new Error('Missing PLATFORM_LOCAL_TENANTS.');
  const identity = new IdentityStore(); identity.mapUser(issuer, subject, subject);
  for (const tenantId of tenantIds) { identity.provision(tenantId); identity.transition(tenantId, 1, 'activate'); identity.membership(tenantId, subject, ['admin']); identity.setMembership(tenantId, subject, 1, 'current'); }
  return identity;
}

const fixtureMeta = { classification: 'fixture', freshness: 'current', completeness: 'full', redaction: 'none' } as const;
const fixtureIds = { package: '11111111-1111-4111-8111-111111111111', installation: '22222222-2222-4222-8222-222222222222', case: '33333333-3333-4333-8333-333333333333', intervention: '44444444-4444-4444-8444-444444444444', operation: '55555555-5555-4555-8555-555555555555', readiness: '66666666-6666-4666-8666-666666666666', assessment: '77777777-7777-4777-8777-777777777777', grant: '88888888-8888-4888-8888-888888888888', capability: '99999999-9999-4999-8999-999999999999', evaluation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', improvement: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', deployment: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', memory: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', correlation: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', agentTeam: 'f1111111-1111-4111-8111-111111111111', workflow: 'f2222222-2222-4222-8222-222222222222', skill: 'f3333333-3333-4333-8333-333333333333', testRun: 'f4444444-4444-4444-8444-444444444444', review: 'f5555555-5555-4555-8555-555555555555', version: 'f6666666-6666-4666-8666-666666666666' } as const;

/** Synthetic browser-only projections. They are deliberately labelled fixture, never provider evidence. */
function fixtureProjection({ context, collection, id }: BrowserProjection): Record<string, unknown> {
  const tenantId = String(context.tenantId);
  const records: Record<string, readonly Record<string, unknown>[]> = {
    packages: [{ ...fixtureMeta, id: fixtureIds.package, name: 'Employee onboarding', version: '1.4.0', approval: 'approved', signature: 'verified', compatibility: 'compatible', validation: 'passed', simulation: 'passed', evaluation: 'current', evidence: 'immutable fixture evidence' }],
    'agent-teams': [{ ...fixtureMeta, id: fixtureIds.agentTeam, name: 'Employee onboarding team', state: 'fixture', members: 'orchestrator, policy-reviewer', delegation: 'orchestrator to policy-reviewer', budgets: 'fixture only' }],
    workflows: [{ ...fixtureMeta, id: fixtureIds.workflow, name: 'Employee onboarding workflow', state: 'fixture', stages: 'intake, review, handoff', interventions: 'approval required' }],
    skills: [{ ...fixtureMeta, id: fixtureIds.skill, name: 'Policy reviewer', state: 'fixture', capabilities: 'no live capability grant', evaluations: 'fixture suite only' }],
    'test-runs': [{ ...fixtureMeta, id: fixtureIds.testRun, package: 'Employee onboarding', revision: 1, type: 'evaluation', status: 'blocked', evidence: 'Fixture evidence cannot release a package.' }],
    reviews: [{ ...fixtureMeta, id: fixtureIds.review, package: 'Employee onboarding', revision: 1, state: 'unavailable', reason: 'No production authority resolver is registered.' }],
    versions: [{ ...fixtureMeta, id: fixtureIds.version, package: 'Employee onboarding', version: '1.4.0', state: 'fixture', changes: 'No governed history is available locally.' }],
    installations: [{ ...fixtureMeta, id: fixtureIds.installation, package: 'Employee onboarding', version: '1.4.0', readiness: 'ready', configuration: 'fixture configuration verified', activation: 'active', provider: 'unavailable - no live provider adapter' }],
    cases: [{ ...fixtureMeta, id: fixtureIds.case, title: 'Technical implementation handoff', state: 'awaiting approval', correlation: fixtureIds.correlation, environment: 'preview', outcome: 'pending', cost: 'unknown', evidence: 'partial fixture evidence' }],
    interventions: [{ ...fixtureMeta, id: fixtureIds.intervention, caseId: fixtureIds.case, type: 'approval', authority: 'release-approver', consequence: 'Allows fixture handoff only', compensation: 'reset fixture run', state: 'pending' }],
    operations: [{ ...fixtureMeta, id: fixtureIds.operation, caseId: fixtureIds.case, effect: 'Provider provisioning', intent: 'simulated', receipt: 'unavailable', reconciliation: 'not started' }],
    readiness: [{ ...fixtureMeta, id: fixtureIds.readiness, packagePin: 'onboarding-assistant@1.4.0', configurationEvidence: 'complete', completedChecks: 'validation, simulation, evaluation', openActions: 'approval required', rollback: 'fixture reset available' }],
    'vendor-assessments': [{ ...fixtureMeta, id: fixtureIds.assessment, vendor: 'Northwind Systems', version: 2, state: 'current', policy: 'conditional approval', authority: 'risk owner', evidence: 'immutable fixture evidence', supersession: 'assessment-00 superseded' }],
    'access-grants': [{ ...fixtureMeta, id: fixtureIds.grant, assessmentId: fixtureIds.assessment, assessmentVersion: 2, subject: 'implementation-team', resource: 'project workspace', privilege: 'contributor', approval: 'approved', canonicalRequest: 'fixture canonical request', graph: 'simulated receipt', jira: 'simulated receipt', expiry: '2099-01-31T00:00:00.000Z', state: 'revocation-pending', reconciliation: 'receipt confirmation required' }],
    capabilities: [{ ...fixtureMeta, id: fixtureIds.capability, name: 'Live provider operations', state: 'unavailable', reason: 'No independently verified live adapter is registered.' }],
    evaluations: [{ ...fixtureMeta, id: fixtureIds.evaluation, package: 'Employee onboarding', state: 'current', evidence: 'fixture evaluation result' }],
    improvements: [{ ...fixtureMeta, id: fixtureIds.improvement, state: 'not-ready', reason: 'No independently verified live adapter is registered.' }],
    deployments: [{ ...fixtureMeta, id: fixtureIds.deployment, environment: 'preview', state: 'fixture only', evidence: 'No Azure or provider operation was performed.' }],
    memory: [{ ...fixtureMeta, id: fixtureIds.memory, state: 'redacted', completeness: 'partial', redaction: 'applied', reason: 'No memory contents are projected to this browser fixture.' }],
  };
  const selected = records[collection] ?? [];
  const scoped = id === undefined ? selected : selected.filter((record) => record['id'] === id);
  return { tenantId, collection, records: scoped, completeness: scoped.some((record) => record['redaction'] !== 'none' || record['state'] === 'unavailable' || record['state'] === 'not-ready') ? 'partial' : 'full', classification: 'fixture', freshness: 'current', redaction: scoped.some((record) => record['redaction'] !== 'none') ? 'applied' : 'none' };
}
