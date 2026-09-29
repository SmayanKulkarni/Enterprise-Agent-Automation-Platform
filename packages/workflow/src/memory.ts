import { createHash } from 'node:crypto';
import type { EmbeddingSettings } from './model-settings.js';
import { canonicalJson, digest } from '../../contracts/src/index.js';
import type { WorkflowRun } from './service.js';

export type MemoryItemType = 'run-summary' | 'task-fact' | 'stated-preference';
export type MemoryItemState = 'pending' | 'promoted' | 'rejected' | 'failed' | 'withdrawn' | 'delete-requested' | 'deleted';
export interface MemoryScope { tenantId: string; stableDefinitionId: string; definitionId: string; revision: number; }
export interface MemoryProposal { type: 'task-fact' | 'stated-preference'; text: string; sourceId: string; sourceDigest: string; excerpt: string; subject?: string; predecessorId?: string; }
export interface MemoryItem { stableDefinitionId: string; definitionId: string; producingRevision: number; type: MemoryItemType; sourceId: string; sourceDigest: string; sourceKind: 'input' | 'event' | 'summary'; fingerprint: string; ownerId?: string; predecessorId?: string; promotedAt?: string; expiresAt?: string; hold?: boolean; failure?: string; vectorState: 'pending' | 'ready' | 'remove-pending' | 'removed'; }
export interface MemoryImport { targetDefinitionId: string; targetRevision: number; sourceDefinitionId: string; state: 'active' | 'revoked'; actorId: string; requestId: string; reason?: string; revokedAt?: string; }
export interface HostedMemoryItem { id: string; text: string; metadata: { stableDefinitionId: string; definitionId: string; producingRevision: number; type: MemoryItemType; sourceId: string; sourceDigest: string; ownerId?: string; state: 'pending' | 'promoted'; promotedAt?: string; expiresAt: string; }; }
export interface HostedMemoryMatch { id: string; score: number; text: string; metadata: HostedMemoryItem['metadata']; }
export interface HostedMemoryPort { readonly readiness: 'disabled' | 'not-configured' | 'ready' | 'unavailable'; enabled(tenantId: string): boolean; upsert(namespace: string, item: HostedMemoryItem): Promise<void>; read(namespace: string, itemId: string): Promise<HostedMemoryItem | undefined>; query(namespace: string, text: string, topK: number, filter: Record<string, string>): Promise<readonly HostedMemoryMatch[]>; remove(namespace: string, itemId: string): Promise<void>; verifyEmbedding?(tenantId: string, settings: EmbeddingSettings): Promise<void>; }

const uuid = (value: string): string => {
  const bytes = createHash('sha256').update(value).digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return `${bytes.subarray(0, 4).toString('hex')}-${bytes.subarray(4, 6).toString('hex')}-${bytes.subarray(6, 8).toString('hex')}-${bytes.subarray(8, 10).toString('hex')}-${bytes.subarray(10, 16).toString('hex')}`;
};
const secret = /(?:api[_ -]?key|authorization|bearer|cookie|credential|password|private[_ -]?key|secret|token)\s*[:=]\s*[^\s,;]+/giu;
const clean = (value: string): string => value.replace(/\s+/gu, ' ').trim();

export const namespace = (tenantId: string): string => `tenant-${tenantId}`;
export const tenantOfNamespace = (space: string): string => space.slice('tenant-'.length);
export const memoryItemId = (fingerprint: string): string => uuid(`memory:${fingerprint}`);
export const memoryFingerprint = async (scope: Pick<MemoryScope, 'tenantId' | 'stableDefinitionId'>, proposal: Pick<MemoryProposal, 'type' | 'sourceId' | 'sourceDigest' | 'subject' | 'text'>): Promise<string> => digest({ scope: { tenantId: scope.tenantId, stableDefinitionId: scope.stableDefinitionId }, type: proposal.type, sourceId: proposal.sourceId, sourceDigest: proposal.sourceDigest, ...(proposal.subject ? { subject: clean(proposal.subject) } : {}), text: clean(proposal.text) });
export const resolveMemoryScope = (run: WorkflowRun): MemoryScope => ({ tenantId: run.tenantId, stableDefinitionId: run.stableDefinitionId, definitionId: run.definitionId, revision: run.definitionRevision });
export const redacted = (value: string): string => value.replace(secret, '[redacted]');
export const proposalSource = async (run: WorkflowRun, sourceId: string): Promise<{ digest: string; text: string; kind: 'input' | 'event'; ownerId?: string } | undefined> => {
  if (sourceId === `input:${run.id}`) return { digest: run.inputDigest, text: canonicalJson(run.input), kind: 'input', ...(run.ownerId ? { ownerId: run.ownerId } : {}) };
  const match = new RegExp(`^event:${run.id}:([a-zA-Z0-9_-]{1,80})$`, 'u').exec(sourceId);
  if (!match) return undefined;
  const event = run.history.find((item) => item.nodeId === match[1] && item.state === 'completed');
  return event ? { digest: await digest(event), text: canonicalJson(event), kind: 'event', ...(run.ownerId ? { ownerId: run.ownerId } : {}) } : undefined;
};
export const validateMemoryProposal = async (proposal: unknown, run: WorkflowRun): Promise<{ proposal: MemoryProposal; sourceKind: 'input' | 'event'; ownerId?: string } | undefined> => {
  if (proposal === null || Array.isArray(proposal) || typeof proposal !== 'object') return undefined;
  const value = proposal as Record<string, unknown>;
  if (Object.keys(value).some((key) => !['type', 'text', 'sourceId', 'sourceDigest', 'excerpt', 'subject', 'predecessorId'].includes(key)) || !['task-fact', 'stated-preference'].includes(String(value['type'])) || typeof value['text'] !== 'string' || typeof value['sourceId'] !== 'string' || typeof value['sourceDigest'] !== 'string' || typeof value['excerpt'] !== 'string' || value['text'].length === 0 || value['text'].length > 1000 || value['excerpt'].length === 0 || value['excerpt'].length > 1000 || !/^[a-f0-9]{64}$/iu.test(value['sourceDigest']) || value['subject'] !== undefined && (typeof value['subject'] !== 'string' || value['subject'].length === 0 || value['subject'].length > 200) || value['predecessorId'] !== undefined && (typeof value['predecessorId'] !== 'string' || !/^[0-9a-f-]{36}$/iu.test(value['predecessorId'])) || value['type'] === 'stated-preference' && typeof value['subject'] !== 'string') return undefined;
  const source = await proposalSource(run, value['sourceId']);
  if (!source || source.digest !== value['sourceDigest']) return undefined;
  const text = clean(value['text']); const excerpt = clean(value['excerpt']);
  if (!text || redacted(text) !== text || redacted(excerpt) !== excerpt || !source.text.includes(excerpt)) return undefined;
  const result: MemoryProposal = { type: value['type'] as MemoryProposal['type'], text, sourceId: value['sourceId'], sourceDigest: value['sourceDigest'].toLowerCase(), excerpt, ...(typeof value['subject'] === 'string' ? { subject: clean(value['subject']) } : {}), ...(typeof value['predecessorId'] === 'string' ? { predecessorId: value['predecessorId'].toLowerCase() } : {}) };
  return { proposal: result, sourceKind: source.kind, ...(result.type === 'stated-preference' ? { ownerId: source.ownerId } : {}) };
};

export class InMemoryHostedMemoryPort implements HostedMemoryPort {
  readonly readiness: HostedMemoryPort['readiness'] = 'ready';
  readonly items = new Map<string, HostedMemoryItem>();
  constructor(private readonly tenants: readonly string[] = []) {}
  enabled(tenantId: string): boolean { return this.tenants.length === 0 || this.tenants.includes(tenantId); }
  async upsert(space: string, item: HostedMemoryItem): Promise<void> { this.items.set(`${space}:${item.id}`, structuredClone(item)); }
  async read(space: string, itemId: string): Promise<HostedMemoryItem | undefined> { const item = this.items.get(`${space}:${itemId}`); return item && structuredClone(item); }
  async query(space: string, _text: string, topK: number, filter: Record<string, string>): Promise<readonly HostedMemoryMatch[]> { return [...this.items.entries()].filter(([key, item]) => key.startsWith(`${space}:`) && Object.entries(filter).every(([name, value]) => String(item.metadata[name as keyof HostedMemoryItem['metadata']]) === value)).map(([, item]) => ({ id: item.id, score: 1, text: item.text, metadata: item.metadata })).sort((left, right) => left.id.localeCompare(right.id)).slice(0, topK); }
  async remove(space: string, itemId: string): Promise<void> { this.items.delete(`${space}:${itemId}`); }
}
