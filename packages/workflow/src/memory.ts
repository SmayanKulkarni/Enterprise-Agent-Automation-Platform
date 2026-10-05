import { createHash } from 'node:crypto';
import type { EmbeddingSettings } from './model-settings.js';
import { canonicalJson, digest } from '../../contracts/src/index.js';
import type { WorkflowRun } from './service.js';

export type MemoryItemType = 'run-summary' | 'task-fact' | 'stated-preference';
export type MemoryItemState = 'pending' | 'promoted' | 'rejected' | 'failed' | 'withdrawn' | 'delete-requested' | 'deleted';
export interface MemoryScope { tenantId: string; stableDefinitionId: string; definitionId: string; revision: number; }
export interface MemoryProposal { type: 'task-fact' | 'stated-preference'; text: string; sourceId: string; sourceDigest: string; excerpt: string; subject?: string; subjects?: string[]; predecessorId?: string; }
export type MemorySourceKind = 'input' | 'event' | 'summary' | 'tool' | 'output';
export type HostedMemoryFilter = Record<string, string | { contains: string }>;
export interface MemoryItem { stableDefinitionId: string; definitionId: string; producingRevision: number; type: MemoryItemType; sourceId: string; sourceDigest: string; sourceKind: MemorySourceKind; fingerprint: string; ownerId?: string; predecessorId?: string; promotedAt?: string; expiresAt?: string; hold?: boolean; failure?: string; subjects?: string[]; observedAt?: string; supersededBy?: string; schemaVersion?: 2; vectorState: 'pending' | 'ready' | 'remove-pending' | 'removed'; }
export interface MemoryImport { targetDefinitionId: string; targetRevision: number; sourceDefinitionId: string; state: 'active' | 'revoked'; actorId: string; requestId: string; reason?: string; revokedAt?: string; }
export interface HostedMemoryItem { id: string; text: string; metadata: { stableDefinitionId: string; definitionId: string; producingRevision: number; type: MemoryItemType; sourceId: string; sourceDigest: string; ownerId?: string; state: 'pending' | 'promoted'; promotedAt?: string; expiresAt: string; subjects?: string[]; observedAt?: string; schemaVersion?: 2; }; }
export interface HostedMemoryMatch { id: string; score: number; text: string; metadata: HostedMemoryItem['metadata']; }
export interface HostedMemoryPort { readonly readiness: 'disabled' | 'not-configured' | 'ready' | 'unavailable'; enabled(tenantId: string): boolean; upsert(namespace: string, item: HostedMemoryItem): Promise<void>; read(namespace: string, itemId: string): Promise<HostedMemoryItem | undefined>; query(namespace: string, text: string, topK: number, filter: HostedMemoryFilter): Promise<readonly HostedMemoryMatch[]>; remove(namespace: string, itemId: string): Promise<void>; verifyEmbedding?(tenantId: string, settings: EmbeddingSettings): Promise<void>; }

const uuid = (value: string): string => {
  const bytes = createHash('sha256').update(value).digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return `${bytes.subarray(0, 4).toString('hex')}-${bytes.subarray(4, 6).toString('hex')}-${bytes.subarray(6, 8).toString('hex')}-${bytes.subarray(8, 10).toString('hex')}-${bytes.subarray(10, 16).toString('hex')}`;
};
const secret = /(?:api[_ -]?key|authorization|bearer|cookie|credential|password|private[_ -]?key|secret|token)\s*[:=]\s*[^\s,;]+/giu;
const SECRET_KEY = /api[_ -]?key|authorization|bearer|cookie|credential|passw(?:or)?d|private[_ -]?key|secret|token/iu;
export const clean = (value: string): string => value.replace(/\s+/gu, ' ').trim();
const DAY_MS = 86400000;
const SUBJECT_KEY = /^[a-z0-9][a-z0-9:._/@#-]{0,79}$/u;
const CLAIM_TOKEN = /[A-Z]{2,}-[\w-]+|\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?|\d[\d.,]*/gu;
const QUOTED_CLAIM = /"([^"]+)"|“([^”]+)”/gu;
const MAX_SUBJECTS = 3;
const MAX_SUBJECT_INPUT = 12;

export const MEMORY_SCHEMA_VERSION = 2;
export const MEMORY_TTL_DAYS: Record<MemoryItemType, number> = { 'task-fact': 90, 'run-summary': 30, 'stated-preference': 180 };
export const memoryExpiry = (type: MemoryItemType, from = Date.now()): string => new Date(from + MEMORY_TTL_DAYS[type] * DAY_MS).toISOString();
export const maxMemoryExpiry = (type: MemoryItemType, from = Date.now()): number => from + MEMORY_TTL_DAYS[type] * DAY_MS;

export const normalizeSubjects = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const keys = value.slice(0, MAX_SUBJECT_INPUT).flatMap((entry): string[] => typeof entry === 'string' ? [entry.trim().toLowerCase()] : []).filter((entry) => SUBJECT_KEY.test(entry));
  return [...new Set(keys)].slice(0, MAX_SUBJECTS);
};
export const memoryMetadataSubjects = (value: unknown): { subjects?: string[] } => Array.isArray(value) ? { subjects: normalizeSubjects(value) } : {};
export const sameSubjects = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && [...left].sort().every((entry, index) => entry === [...right].sort()[index]);

const tokenInSource = (token: string, source: string): boolean => new RegExp(`(?<![A-Za-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![A-Za-z0-9])`, 'u').test(source);
export const ungroundedClaims = (text: string, source: string): string[] => {
  const tokens = [...text.matchAll(CLAIM_TOKEN)].map((match) => match[0].replace(/[.,]+$/u, '')).filter(Boolean);
  const quoted = [...text.matchAll(QUOTED_CLAIM)].map((match) => match[1] ?? match[2] ?? '');
  return [...tokens.filter((token) => !tokenInSource(token, source)), ...quoted.filter((entry) => !source.includes(entry))];
};
export const claimsGrounded = (text: string, source: string): boolean => ungroundedClaims(text, source).length === 0;

export const namespace = (tenantId: string): string => `tenant-${tenantId}`;
export const tenantOfNamespace = (space: string): string => space.slice('tenant-'.length);
export const memoryItemId = (fingerprint: string): string => uuid(`memory:${fingerprint}`);
export const memoryFingerprint = async (scope: Pick<MemoryScope, 'tenantId' | 'stableDefinitionId'>, proposal: Pick<MemoryProposal, 'type' | 'sourceId' | 'sourceDigest' | 'subject' | 'text'>): Promise<string> => digest({ scope: { tenantId: scope.tenantId, stableDefinitionId: scope.stableDefinitionId }, type: proposal.type, sourceId: proposal.sourceId, sourceDigest: proposal.sourceDigest, ...(proposal.subject ? { subject: clean(proposal.subject) } : {}), text: clean(proposal.text) });
export const memoryFingerprintV2 = async (scope: Pick<MemoryScope, 'tenantId' | 'stableDefinitionId'>, proposal: Pick<MemoryProposal, 'type' | 'subject' | 'text'> & { subjects: readonly string[]; ownerId?: string | undefined }): Promise<string> => digest({ scope: { tenantId: scope.tenantId, stableDefinitionId: scope.stableDefinitionId }, type: proposal.type, subjects: [...proposal.subjects].sort(), ...(proposal.ownerId ? { ownerId: proposal.ownerId } : {}), ...(proposal.subject ? { subject: clean(proposal.subject) } : {}), text: clean(proposal.text), schemaVersion: MEMORY_SCHEMA_VERSION });
export const resolveMemoryScope = (run: WorkflowRun): MemoryScope => ({ tenantId: run.tenantId, stableDefinitionId: run.stableDefinitionId, definitionId: run.definitionId, revision: run.definitionRevision });
export const redacted = (value: string): string => value.replace(secret, '[redacted]');
export const redactedDeep = (value: unknown): unknown => {
  if (typeof value === 'string') return redacted(value);
  if (Array.isArray(value)) return value.map(redactedDeep);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, SECRET_KEY.test(key) ? '[redacted]' : redactedDeep(child)]));
  return value;
};
export const toolSourceId = (runId: string, agentNodeId: string, callId: string): string => `tool:${runId}:${agentNodeId}:${callId}`;

interface ProposalSource { digest: string; text: string; kind: Extract<MemorySourceKind, 'input' | 'event' | 'tool' | 'output'>; ownerId?: string }
export const proposalSource = async (run: WorkflowRun, sourceId: string): Promise<ProposalSource | undefined> => {
  const owner = run.ownerId ? { ownerId: run.ownerId } : {};
  if (sourceId === `input:${run.id}`) return { digest: run.inputDigest, text: canonicalJson(run.input), kind: 'input', ...owner };
  const completed = (nodeId: string | undefined) => run.history.find((item) => item.nodeId === nodeId && item.state === 'completed');
  const eventMatch = new RegExp(`^event:${run.id}:([a-zA-Z0-9_-]{1,80})$`, 'u').exec(sourceId);
  if (eventMatch) { const event = completed(eventMatch[1]); return event ? { digest: await digest(event), text: canonicalJson(event), kind: 'event', ...owner } : undefined; }
  const [, outputNode = ''] = new RegExp(`^output:${run.id}:([a-zA-Z0-9_-]{1,80})$`, 'u').exec(sourceId) ?? [];
  if (outputNode) { const output = run.outputs[outputNode]; return output && Object.keys(output).length > 0 && completed(outputNode) ? { digest: await digest(output), text: canonicalJson(output), kind: 'output', ...owner } : undefined; }
  const [, toolNode = '', callId = ''] = new RegExp(`^tool:${run.id}:([a-zA-Z0-9_-]{1,80}):(.{1,200})$`, 'u').exec(sourceId) ?? [];
  if (!toolNode) return undefined;
  const entry = run.agents?.[toolNode]?.transcript.find((item) => item.role === 'tool' && item.callId === callId);
  return entry?.role === 'tool' ? { digest: await digest(entry), text: entry.content, kind: 'tool', ...owner } : undefined;
};

export type ProposalRejection = 'INVALID_ARGUMENTS' | 'UNGROUNDED_CLAIM';
export interface AdmittedProposal { proposal: MemoryProposal; sourceKind: ProposalSource['kind']; ownerId?: string }
const PROPOSAL_KEYS = ['type', 'text', 'sourceId', 'sourceDigest', 'excerpt', 'subject', 'subjects', 'predecessorId'];
export const checkMemoryProposal = async (proposal: unknown, run: WorkflowRun): Promise<{ admitted: AdmittedProposal } | { reason: ProposalRejection }> => {
  const invalid = { reason: 'INVALID_ARGUMENTS' as const };
  if (proposal === null || Array.isArray(proposal) || typeof proposal !== 'object') return invalid;
  const value = proposal as Record<string, unknown>;
  if (Object.keys(value).some((key) => !PROPOSAL_KEYS.includes(key)) || !['task-fact', 'stated-preference'].includes(String(value['type'])) || typeof value['text'] !== 'string' || typeof value['sourceId'] !== 'string' || typeof value['sourceDigest'] !== 'string' || typeof value['excerpt'] !== 'string' || value['text'].length === 0 || value['text'].length > 1000 || value['excerpt'].length === 0 || value['excerpt'].length > 1000 || !/^[a-f0-9]{64}$/iu.test(value['sourceDigest']) || value['subject'] !== undefined && (typeof value['subject'] !== 'string' || value['subject'].length === 0 || value['subject'].length > 200) || value['subjects'] !== undefined && !Array.isArray(value['subjects']) || value['predecessorId'] !== undefined && (typeof value['predecessorId'] !== 'string' || !/^[0-9a-f-]{36}$/iu.test(value['predecessorId'])) || value['type'] === 'stated-preference' && typeof value['subject'] !== 'string') return invalid;
  const source = await proposalSource(run, value['sourceId']);
  if (!source || source.digest !== value['sourceDigest']) return invalid;
  const text = clean(value['text']); const excerpt = clean(value['excerpt']);
  if (!text || redacted(text) !== text || redacted(excerpt) !== excerpt || !source.text.includes(excerpt)) return invalid;
  if (!claimsGrounded(text, source.text)) return { reason: 'UNGROUNDED_CLAIM' };
  const subjects = normalizeSubjects(value['subjects']);
  const result: MemoryProposal = { type: value['type'] as MemoryProposal['type'], text, sourceId: value['sourceId'], sourceDigest: value['sourceDigest'].toLowerCase(), excerpt, ...(typeof value['subject'] === 'string' ? { subject: clean(value['subject']) } : {}), subjects, ...(typeof value['predecessorId'] === 'string' ? { predecessorId: value['predecessorId'].toLowerCase() } : {}) };
  return { admitted: { proposal: result, sourceKind: source.kind, ...(result.type === 'stated-preference' ? { ownerId: source.ownerId } : {}) } };
};
export const validateMemoryProposal = async (proposal: unknown, run: WorkflowRun): Promise<AdmittedProposal | undefined> => {
  const checked = await checkMemoryProposal(proposal, run);
  return 'admitted' in checked ? checked.admitted : undefined;
};

export type MemoryScorer = (query: string, text: string) => number;
const matchesFilter = (metadata: HostedMemoryItem['metadata'], filter: HostedMemoryFilter): boolean => Object.entries(filter).every(([name, value]) => {
  const field: unknown = metadata[name as keyof HostedMemoryItem['metadata']];
  return typeof value === 'string' ? String(field) === value : Array.isArray(field) && field.includes(value.contains);
});

export class InMemoryHostedMemoryPort implements HostedMemoryPort {
  readonly readiness: HostedMemoryPort['readiness'] = 'ready';
  readonly items = new Map<string, HostedMemoryItem>();
  constructor(private readonly tenants: readonly string[] = [], private readonly scorer: MemoryScorer = () => 1) {}
  enabled(tenantId: string): boolean { return this.tenants.length === 0 || this.tenants.includes(tenantId); }
  async upsert(space: string, item: HostedMemoryItem): Promise<void> { this.items.set(`${space}:${item.id}`, structuredClone(item)); }
  async read(space: string, itemId: string): Promise<HostedMemoryItem | undefined> { const item = this.items.get(`${space}:${itemId}`); return item && structuredClone(item); }
  async query(space: string, text: string, topK: number, filter: HostedMemoryFilter): Promise<readonly HostedMemoryMatch[]> { return [...this.items.entries()].filter(([key, item]) => key.startsWith(`${space}:`) && matchesFilter(item.metadata, filter)).map(([, item]) => ({ id: item.id, score: this.scorer(text, item.text), text: item.text, metadata: item.metadata })).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id)).slice(0, topK); }
  async remove(space: string, itemId: string): Promise<void> { this.items.delete(`${space}:${itemId}`); }
}
