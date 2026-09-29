export const BROWSER_COLLECTIONS = ['cases', 'interventions', 'capabilities', 'installations', 'memory', 'evaluations', 'improvements', 'packages', 'agent-teams', 'workflows', 'skills', 'test-runs', 'reviews', 'versions', 'operations', 'deployments', 'readiness', 'vendor-assessments', 'access-grants', 'workflow-drafts', 'workflow-revisions', 'workflow-definitions', 'workflow-runs', 'workflow-grants', 'workflow-webhook-credentials', 'workflow-memory-imports', 'workflow-memory-items', 'workflow-memory-readiness', 'workflow-model-settings', 'connector-installations', 'openrouter-connections', 'openrouter-models'] as const;
export type BrowserCollection = typeof BROWSER_COLLECTIONS[number];

export const COMMANDS = {
  identity: ['request-approval', 'decide-approval', 'revoke-approval', 'grant-membership', 'revoke-membership'],
  studio: ['create-draft', 'save-draft', 'run-checks', 'simulate', 'evaluate', 'submit'],
  lifecycle: ['review', 'sign', 'publish', 'install', 'activate', 'upgrade', 'rollback', 'quarantine', 'retire'],
  case: ['create', 'submit', 'start', 'cancel', 'reopen', 'pause', 'resume', 'retry', 'reconcile', 'compensate'],
  intervention: ['provide-information', 'approve', 'reject'],
  gateway: ['install', 'validate', 'disable', 'reauthorize', 'rotate', 'revoke', 'reconcile'],
  memory: ['correct', 'export', 'hold', 'release', 'delete', 'restore', 'review', 'promote'],
  improvement: ['create', 'evaluate', 'shadow', 'canary', 'promote', 'rollback'],
  deployment: ['deploy', 'restore', 'teardown'],
  portfolio: ['start-run', 'reset-run', 'publish-evidence', 'score-run'],
  vendor: ['start-assessment', 'decide-assessment', 'supersede-assessment', 'request-grant', 'approve-grant', 'provision-grant', 'revoke-grant', 'expire-grant', 'reconcile-grant'],
  workflow: ['check', 'publish', 'start', 'approve', 'grant', 'certify', 'reconcile', 'enroll', 'rotate', 'revoke', 'provision-webhook-credential', 'rotate-webhook-credential', 'disable-webhook-credential', 'test-webhook', 'import-memory', 'revoke-memory-import', 'withdraw-memory', 'hold-memory', 'release-memory-hold', 'set-memory-expiry', 'delete-memory', 'correct-memory', 'invalidate-memory-source', 'configure-model-settings'],
} as const;
export type CommandOwner = keyof typeof COMMANDS;
export type CommandName<Owner extends CommandOwner = CommandOwner> = typeof COMMANDS[Owner][number];
export type ActionRisk = 'R1' | 'R2' | 'R3';
export interface ActionHint { owner: CommandOwner; name: CommandName; objectId: string; expectedVersion: number; risk: ActionRisk; approvalRequired: boolean; reason?: string; }
export interface CommandReceipt { commandId: string; objectId: string; owner: CommandOwner; name: CommandName; state: 'committed' | 'unknown-outcome'; version: number; watermark: number; affectedCollections: readonly BrowserCollection[]; evidenceIds: readonly string[]; digest: string; }
export interface BrowserProjection { tenantId: string; collection: BrowserCollection; records: readonly Record<string, unknown>[]; completeness: 'full' | 'partial' | 'not-ready'; classification: 'ordinary' | 'restricted-operational' | 'fixture'; freshness: 'current' | 'stale' | 'unknown'; redaction: 'none' | 'applied'; watermark?: number; publishedAt?: string; continuation?: { cursor: string }; }
export interface BrowserSession { tenantId: string; actionHints: readonly ActionHint[]; }
export interface BrowserTenant { id: string; profiles: readonly string[]; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DIGEST = /^[a-f0-9]{64}$/iu;
const forbidden = /(?:token|secret|password|credential|payload|api.?key|private.?key|authorization|connection.?string|cookie|bearer)/iu;
const argumentKeys: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'studio.create-draft': ['id', 'draft'], 'studio.save-draft': ['id', 'draft'], 'studio.run-checks': ['id'], 'studio.simulate': ['id', 'fixtureId'], 'studio.evaluate': ['id', 'suiteId'], 'studio.submit': ['id'],
  'lifecycle.review': ['id', 'decision', 'reason'], 'lifecycle.sign': ['id'], 'lifecycle.publish': ['id', 'visibility'],
  'workflow.check': ['id'], 'workflow.publish': ['id', 'reviewDigest'], 'workflow.start': ['id', 'input'], 'workflow.approve': ['id', 'bindingDigest', 'decision'],
  'workflow.grant': ['id', 'nodeId', 'installationId', 'capability'], 'workflow.certify': ['id', 'installation'],
  'workflow.reconcile': ['id', 'disposition'], 'workflow.enroll': ['id'], 'workflow.rotate': ['id'], 'workflow.revoke': ['id'],
  'workflow.provision-webhook-credential': ['id'], 'workflow.rotate-webhook-credential': ['id'], 'workflow.disable-webhook-credential': ['id'],
  'workflow.test-webhook': ['id', 'input'],
  'workflow.import-memory': ['id', 'sourceDefinitionId'], 'workflow.revoke-memory-import': ['id', 'reason'],
  'workflow.withdraw-memory': ['id', 'reason'], 'workflow.hold-memory': ['id', 'reason'], 'workflow.release-memory-hold': ['id', 'reason'], 'workflow.set-memory-expiry': ['id', 'expiresAt'], 'workflow.delete-memory': ['id', 'reason'],
  'workflow.correct-memory': ['id', 'text'], 'workflow.invalidate-memory-source': ['sourceId'], 'workflow.configure-model-settings': ['id', 'settings'],
});
export const hasCommandArgumentSchema = (owner: string, name: string): boolean => Object.hasOwn(argumentKeys, `${owner}.${name}`);

export class BrowserContractError extends Error { constructor(readonly code: 'INVALID_BROWSER_DTO' | 'UNSUPPORTED_COMMAND') { super('Browser data was not accepted.'); } }
const fail = (code: BrowserContractError['code'] = 'INVALID_BROWSER_DTO'): never => { throw new BrowserContractError(code); };
const record = (value: unknown, allowed: readonly string[]): Record<string, unknown> => {
  if (value === null || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some((key) => !allowed.includes(key))) fail();
  return value as Record<string, unknown>;
};
const id = (value: unknown): string => typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : fail();
const nonNegativeInteger = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail();
const string = (value: unknown): string => typeof value === 'string' && value.length > 0 ? value : fail();
const oneOf = <Value extends string>(value: unknown, values: readonly Value[]): Value => typeof value === 'string' && values.includes(value as Value) ? value as Value : fail();
const safe = (value: unknown): boolean => value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || Array.isArray(value) && value.every(safe) || typeof value === 'object' && value !== null && !Array.isArray(value) && Object.entries(value as Record<string, unknown>).every(([key, child]) => (key === 'tokens' || !forbidden.test(key)) && safe(child));

export function decodeCommandArguments(owner: string, name: string, value: unknown): Record<string, unknown> {
  if (!(owner in COMMANDS) || !COMMANDS[owner as CommandOwner].includes(name as never)) fail('UNSUPPORTED_COMMAND');
  const allowed = argumentKeys[`${owner}.${name}`] ?? fail('UNSUPPORTED_COMMAND');
  const parsed = record(value, allowed);
  if (!safe(parsed)) fail();
  for (const key of allowed) if (!(key in parsed)) fail();
  if ('id' in parsed) id(parsed['id']);
  if ('fixtureId' in parsed) string(parsed['fixtureId']);
  if ('suiteId' in parsed) string(parsed['suiteId']);
  if ('decision' in parsed) oneOf(parsed['decision'], ['approve', 'reject']);
  if ('reason' in parsed) string(parsed['reason']);
  if ('visibility' in parsed) oneOf(parsed['visibility'], ['tenant', 'catalog']);
  if ('installationId' in parsed) id(parsed['installationId']);
  if ('sourceDefinitionId' in parsed) id(parsed['sourceDefinitionId']);
  if ('sourceId' in parsed) string(parsed['sourceId']);
  if ('text' in parsed && (typeof parsed['text'] !== 'string' || parsed['text'].length === 0 || parsed['text'].length > 1000)) fail();
  if ('expiresAt' in parsed && (typeof parsed['expiresAt'] !== 'string' || Number.isNaN(Date.parse(parsed['expiresAt'])))) fail();
  if ('reviewDigest' in parsed && (typeof parsed['reviewDigest'] !== 'string' || !DIGEST.test(parsed['reviewDigest']))) fail();
  if ('bindingDigest' in parsed && (typeof parsed['bindingDigest'] !== 'string' || !DIGEST.test(parsed['bindingDigest']))) fail();
  if ('nodeId' in parsed) string(parsed['nodeId']);
  if ('capability' in parsed) string(parsed['capability']);
  if ('disposition' in parsed) oneOf(parsed['disposition'], ['adopt', 'no-effect']);
  return Object.freeze({ ...parsed });
}

export function decodeActionHint(value: unknown): ActionHint {
  const parsed = record(value, ['owner', 'name', 'objectId', 'expectedVersion', 'risk', 'approvalRequired', 'reason']);
  const owner = oneOf(parsed['owner'], Object.keys(COMMANDS) as CommandOwner[]);
  const name = oneOf(parsed['name'], COMMANDS[owner]) as CommandName;
  const approvalRequired = parsed['approvalRequired'];
  if (approvalRequired !== true && approvalRequired !== false || parsed['reason'] !== undefined && typeof parsed['reason'] !== 'string') fail();
  return Object.freeze({ owner, name, objectId: id(parsed['objectId']), expectedVersion: nonNegativeInteger(parsed['expectedVersion']), risk: oneOf(parsed['risk'], ['R1', 'R2', 'R3']), approvalRequired: approvalRequired as boolean, ...(parsed['reason'] === undefined ? {} : { reason: parsed['reason'] as string }) });
}

export function decodeSession(value: unknown): BrowserSession {
  const parsed = record(value, ['user', 'tenant', 'actionHints', 'completeness']);
  const tenant = record(parsed['tenant'], ['id', 'epoch']);
  if (parsed['user'] !== undefined) record(parsed['user'], ['id']);
  const actionHints = parsed['actionHints']; if (!Array.isArray(actionHints)) fail();
  return Object.freeze({ tenantId: id(tenant['id']), actionHints: Object.freeze((actionHints as unknown[]).map(decodeActionHint)) });
}

export function decodeTenants(value: unknown): readonly BrowserTenant[] {
  const parsed = record(value, ['tenants', 'completeness']);
  const tenants = parsed['tenants']; if (!Array.isArray(tenants)) fail();
  return Object.freeze((tenants as unknown[]).map((tenant: unknown) => {
    const item = record(tenant, ['id', 'profiles', 'epoch']);
    const profiles = item['profiles']; if (!Array.isArray(profiles) || !profiles.every((profile) => typeof profile === 'string')) fail();
    return Object.freeze({ id: id(item['id']), profiles: Object.freeze([...(profiles as string[])]) });
  }));
}

export function decodeProjection(value: unknown, expectedTenantId: string, expectedCollection?: BrowserCollection): BrowserProjection {
  const parsed = record(value, ['tenantId', 'collection', 'records', 'completeness', 'classification', 'freshness', 'redaction', 'watermark', 'publishedAt', 'continuation']);
  const tenantId = id(parsed['tenantId']); if (tenantId !== id(expectedTenantId)) fail();
  const collection = oneOf(parsed['collection'], BROWSER_COLLECTIONS); if (expectedCollection !== undefined && collection !== expectedCollection) fail();
  const records = parsed['records']; if (!Array.isArray(records)) fail();
  for (const item of records as unknown[]) { const itemRecord = item !== null && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : fail(); id(itemRecord['id']); if (itemRecord['tenantId'] !== undefined && id(itemRecord['tenantId']) !== tenantId || !safe(itemRecord)) fail(); }
  if (parsed['watermark'] !== undefined) nonNegativeInteger(parsed['watermark']);
  if (parsed['publishedAt'] !== undefined && (typeof parsed['publishedAt'] !== 'string' || Number.isNaN(Date.parse(parsed['publishedAt'])))) fail();
  const continuation = parsed['continuation'];
  if (continuation !== undefined && (continuation === null || typeof continuation !== 'object' || Array.isArray(continuation) || Object.keys(continuation).length !== 1 || typeof (continuation as Record<string, unknown>)['cursor'] !== 'string' || !/^[A-Za-z0-9_-]+$/u.test((continuation as Record<string, unknown>)['cursor'] as string))) fail();
  return Object.freeze({ tenantId, collection, records: Object.freeze((records as Record<string, unknown>[]).map((item) => Object.freeze({ ...item }))), completeness: oneOf(parsed['completeness'], ['full', 'partial', 'not-ready']), classification: oneOf(parsed['classification'], ['ordinary', 'restricted-operational', 'fixture']), freshness: oneOf(parsed['freshness'], ['current', 'stale', 'unknown']), redaction: oneOf(parsed['redaction'], ['none', 'applied']), ...(parsed['watermark'] === undefined ? {} : { watermark: nonNegativeInteger(parsed['watermark']) }), ...(parsed['publishedAt'] === undefined ? {} : { publishedAt: parsed['publishedAt'] as string }), ...(continuation === undefined ? {} : { continuation: { cursor: (continuation as Record<string, unknown>)['cursor'] as string } }) });
}

export function decodeReceipt(value: unknown): CommandReceipt {
  const parsed = record(value, ['commandId', 'objectId', 'owner', 'name', 'state', 'version', 'watermark', 'affectedCollections', 'evidenceIds', 'digest']);
  const owner = oneOf(parsed['owner'], Object.keys(COMMANDS) as CommandOwner[]);
  const name = oneOf(parsed['name'], COMMANDS[owner]) as CommandName;
  const affectedCollections = parsed['affectedCollections']; const evidenceIds = parsed['evidenceIds']; const receiptDigest = parsed['digest'];
  if (!Array.isArray(affectedCollections) || !Array.isArray(evidenceIds) || !affectedCollections.every((collection) => BROWSER_COLLECTIONS.includes(collection as BrowserCollection)) || !evidenceIds.every((evidenceId) => typeof evidenceId === 'string' && UUID.test(evidenceId)) || typeof receiptDigest !== 'string' || !DIGEST.test(receiptDigest)) fail();
  return Object.freeze({ commandId: id(parsed['commandId']), objectId: id(parsed['objectId']), owner, name, state: oneOf(parsed['state'], ['committed', 'unknown-outcome']), version: nonNegativeInteger(parsed['version']), watermark: nonNegativeInteger(parsed['watermark']), affectedCollections: Object.freeze([...(affectedCollections as BrowserCollection[])]), evidenceIds: Object.freeze((evidenceIds as unknown[]).map(id)), digest: (receiptDigest as string).toLowerCase() });
}
