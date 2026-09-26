import { digest } from '../../contracts/src/index.js';
import { createHash } from 'node:crypto';
import type { StudioStore } from '../../lifecycle/src/studio-sql.js';
import { validateGraph, type GraphDraft } from '../../workflow/src/graph.js';
import { WorkflowService, type Installation, type WorkflowRun } from '../../workflow/src/service.js';
import type { WorkflowStore } from '../../workflow/src/sql.js';
import type { EffectData } from '../../workflow/src/runtime.js';
import type { BrowserCommand, BrowserCommandHandler } from './index.js';
import { decodeCommandArguments } from './browser-contracts.js';

const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const args = (command: BrowserCommand, keys: string[]): Record<string, unknown> => {
  const value = decodeCommandArguments(command.owner, command.name, command.envelope.payload['arguments']);
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !(key in value))) fail('INVALID');
  return value as Record<string, unknown>;
};
const id = (value: unknown): string => typeof value === 'string' && uuid.test(value) ? value : fail('INVALID');
const string = (value: unknown): string => typeof value === 'string' && value.length > 0 ? value : fail('INVALID');
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail('INVALID');
const graph = (value: unknown): GraphDraft => {
  const draft = record(value);
  if (draft['kind'] !== 'graph-v1' || !Array.isArray(draft['nodes']) || !Array.isArray(draft['edges']) || validateGraph(draft).some((issue) => issue.code === 'INVALID_GRAPH' || issue.code === 'INVALID_NODE')) fail('INVALID');
  return draft as unknown as GraphDraft;
};
const receipt = (command: BrowserCommand, objectId: string, revision: number, state: string, valueDigest: string, evidenceIds: string[] = []): Record<string, unknown> => ({ commandId: command.idempotencyKey, objectId, revision, state, digest: valueDigest, evidenceIds });
const effectKey = (key: string): string => { const bytes = createHash('sha256').update(`${key}:effect`).digest(); bytes[6] = (bytes[6]! & 15) | 80; bytes[8] = (bytes[8]! & 63) | 128; return `${bytes.subarray(0, 4).toString('hex')}-${bytes.subarray(4, 6).toString('hex')}-${bytes.subarray(6, 8).toString('hex')}-${bytes.subarray(8, 10).toString('hex')}-${bytes.subarray(10, 16).toString('hex')}`; };

export function workflowCommandHandlers(studio: StudioStore, store: WorkflowStore, service: WorkflowService): Record<string, BrowserCommandHandler> {
  return {
    'studio.create-draft': async (command) => {
      const value = args(command, ['id', 'draft']); const draftId = id(value['id']); const data = graph(value['draft']);
      await store.assertProfile(command.context, 'editor');
      const saved = await studio.create(command.context, draftId, data, command.idempotencyKey);
      return receipt(command, draftId, saved.revision, 'draft', saved.digest);
    },
    'studio.save-draft': async (command) => {
      const value = args(command, ['id', 'draft']); const draftId = id(value['id']); const data = graph(value['draft']);
      await store.assertProfile(command.context, 'editor');
      const saved = await studio.save(command.context, draftId, command.expectedVersion, data, command.idempotencyKey);
      return receipt(command, draftId, saved.revision, 'draft', saved.digest);
    },
    'workflow.check': async (command) => {
      const draftId = id(args(command, ['id'])['id']); const result = await service.check(command.context, draftId, command.expectedVersion);
      return { ...receipt(command, draftId, result.revision, result.issues.length ? 'failed' : 'passed', result.candidateDigest ?? result.digest, [result.evidenceId]), issues: result.issues };
    },
    'workflow.publish': async (command) => {
      const value = args(command, ['id', 'reviewDigest']); const definition = await service.publish(command.context, id(value['id']), string(value['reviewDigest']), command.expectedVersion);
      return receipt(command, definition.id, definition.revision, 'published', definition.digest);
    },
    'workflow.start': async (command) => {
      const value = args(command, ['id', 'input']); const publishedId = id(value['id']); const result = await service.start(command.context, publishedId, record(value['input']), command.idempotencyKey, command.digest);
      return receipt(command, result.runId, 1, 'queued', result.digest);
    },
    'workflow.approve': async (command) => {
      const value = args(command, ['id', 'bindingDigest', 'decision']); const runId = id(value['id']); const decision = value['decision']; if (decision !== 'approve' && decision !== 'reject') fail('INVALID');
      await service.approve(command.context, runId, string(value['bindingDigest']), decision as 'approve' | 'reject', command.expectedVersion, command.idempotencyKey, command.digest);
      return receipt(command, runId, command.expectedVersion + 1, decision as string, string(value['bindingDigest']));
    },
    'workflow.grant': async (command) => {
      const value = args(command, ['id', 'nodeId', 'installationId', 'capability']); const draftId = id(value['id']); const installationId = id(value['installationId']);
      await service.grant(command.context, draftId, string(value['nodeId']), installationId, string(value['capability']), command.idempotencyKey, command.digest);
      return receipt(command, command.idempotencyKey, 1, 'active', command.digest);
    },
    ...Object.fromEntries(([
      ['provision-webhook-credential', 'provision'], ['rotate-webhook-credential', 'rotate'], ['disable-webhook-credential', 'disable'],
    ] as const).map(([name, action]) => [`workflow.${name}`, async (command: BrowserCommand) => {
      const definitionId = id(args(command, ['id'])['id']);
      const secret = await service.webhookCredential(command.context, definitionId, action, command.expectedVersion, command.idempotencyKey, command.digest);
      return { ...receipt(command, definitionId, command.expectedVersion + 1, action, command.digest), ...(secret ? { webhookSecret: secret } : {}) };
    }])),
    'workflow.test-webhook': async (command) => {
      const value = args(command, ['id', 'input']); const definitionId = id(value['id']); const input = record(value['input']);
      const delivered = await service.testWebhook(command.context, definitionId, input);
      return { ...receipt(command, delivered.runId ?? definitionId, 0, delivered.outcome, command.digest), webhookTest: delivered };
    },
    'workflow.import-memory': async (command) => {
      const value = args(command, ['id', 'sourceDefinitionId']); const targetDefinitionId = id(value['id']); const sourceDefinitionId = id(value['sourceDefinitionId']);
      await service.importMemory(command.context, targetDefinitionId, sourceDefinitionId, command.idempotencyKey, command.digest);
      return receipt(command, command.idempotencyKey, 1, 'active', command.digest);
    },
    'workflow.revoke-memory-import': async (command) => {
      const value = args(command, ['id', 'reason']); const importId = id(value['id']);
      await service.revokeMemoryImport(command.context, importId, command.expectedVersion, string(value['reason']), command.idempotencyKey, command.digest);
      return receipt(command, importId, command.expectedVersion + 1, 'revoked', command.digest);
    },
    ...Object.fromEntries(([
      ['withdraw-memory', 'withdraw'], ['hold-memory', 'hold'], ['release-memory-hold', 'release-hold'], ['set-memory-expiry', 'set-expiry'], ['delete-memory', 'delete'],
    ] as const).map(([name, action]) => [`workflow.${name}`, async (command: BrowserCommand) => {
      const value = args(command, action === 'set-expiry' ? ['id', 'expiresAt'] : ['id', 'reason']);
      const itemId = id(value['id']);
      await service.memoryLifecycle(command.context, action, itemId, command.expectedVersion, command.idempotencyKey, command.digest, typeof value['reason'] === 'string' ? value['reason'] : undefined, typeof value['expiresAt'] === 'string' ? value['expiresAt'] : undefined);
      return receipt(command, itemId, command.expectedVersion + 1, action, command.digest);
    }])),
    'workflow.correct-memory': async (command) => {
      const value = args(command, ['id', 'text']); const itemId = id(value['id']);
      await service.correctMemory(command.context, itemId, string(value['text']), command.expectedVersion, command.idempotencyKey, command.digest);
      return receipt(command, itemId, command.expectedVersion + 1, 'corrected', command.digest);
    },
    'workflow.invalidate-memory-source': async (command) => {
      const sourceId = string(args(command, ['sourceId'])['sourceId']);
      await service.invalidateMemorySource(command.context, sourceId, command.idempotencyKey, command.digest);
      return receipt(command, command.idempotencyKey, 1, 'invalidated', command.digest);
    },
    'workflow.certify': async (command) => {
      const value = args(command, ['id', 'installation']); const installationId = id(value['id']); const data = record(value['installation']) as unknown as Installation;
      if (Object.keys(data).some((key) => !['route', 'endpoint', 'health', 'manifest'].includes(key)) || !data.manifest || typeof data.manifest !== 'object') fail('INVALID');
      await service.certify(command.context, installationId, data, command.expectedVersion, command.idempotencyKey, command.digest);
      return receipt(command, installationId, command.expectedVersion + 1, data.health, data.manifest.digest);
    },
    'workflow.reconcile': async (command) => {
      const value = args(command, ['id', 'disposition']); const runId = id(value['id']); const disposition = value['disposition']; if (disposition !== 'adopt' && disposition !== 'no-effect') fail('INVALID');
      await store.assertProfile(command.context, 'admin');
      const current = await store.read<WorkflowRun>(command.context, 'run', runId);
      if (!current || current.state !== 'unknown-outcome' || current.version !== command.expectedVersion) throw Object.assign(new Error('STALE'), { code: 'STALE' });
      const unresolved = (await store.list<EffectData>(command.context, 'effect')).find((item) => item.data.runId === runId && ['possible-send', 'unknown-outcome', 'succeeded', 'failed'].includes(item.state)) ?? fail('STALE');
      const choice = disposition as 'adopt' | 'no-effect';
      if (['possible-send', 'unknown-outcome'].includes(unresolved.state)) await store.write(command.context, 'admin', 'effect', unresolved.id, unresolved.version, choice === 'adopt' ? 'succeeded' : 'failed', { ...unresolved.data, state: choice === 'adopt' ? 'succeeded' : 'failed' }, effectKey(command.idempotencyKey), command.digest, receipt(command, unresolved.id, unresolved.version + 1, choice, unresolved.data.requestDigest));
      const data: WorkflowRun = { ...current.data, status: 'failed', history: [...current.data.history, { nodeId: unresolved.data.nodeId, kind: 'reconciliation', state: 'failed', at: new Date().toISOString(), detail: choice, receiptId: unresolved.id }] };
      const result = receipt(command, runId, current.version + 1, 'failed', await digest(data.history));
      await store.write(command.context, 'admin', 'run', runId, current.version, 'failed', data, command.idempotencyKey, command.digest, result);
      return result;
    },
    ...Object.fromEntries((['enroll', 'rotate', 'revoke'] as const).map((action) => [`workflow.${action}`, async (command: BrowserCommand) => {
      const installationId = id(args(command, ['id'])['id']);
      const token = await service.token(command.context, installationId, command.expectedVersion, action, command.idempotencyKey, command.digest);
      return { ...receipt(command, installationId, command.expectedVersion + 1, action, command.digest), ...(token ? { enrollmentToken: token } : {}) };
    }])),
  };
}
