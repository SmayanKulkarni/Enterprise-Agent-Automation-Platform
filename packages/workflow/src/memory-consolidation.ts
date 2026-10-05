import { trace } from '@opentelemetry/api';
import { report } from '../../errors/src/report.js';
import { memoryConsolidated } from './run-telemetry.js';
import { namespace, sameSubjects, type HostedMemoryPort, type MemoryItem, type MemoryItemType } from './memory.js';
import type { WorkflowRecord, WorkflowStore } from './sql.js';

export type ConsolidationDecision = 'add' | 'supersede' | 'noop';
export type ConsolidationPath = 'deterministic' | 'model' | 'fallback';
export interface ConsolidationRequest { tenantId: string; runId: string; item: { text: string; observedAt?: string }; candidates: { id: string; text: string; observedAt?: string }[]; }
export interface ConsolidationAnswer { decision: string; targetId?: string; model: string; promptVersion: string; }
export interface ConsolidationPort { consolidate?(request: ConsolidationRequest): Promise<ConsolidationAnswer>; }
export interface ConsolidationRecord { decision: ConsolidationDecision; targetId?: string; path: ConsolidationPath; scores: { id: string; score: number }[]; model?: string; promptVersion?: string; corroboratedBy?: string[]; }

export const CONSOLIDATE_MIN = 0.88;
export const DUPLICATE_MIN = 0.97;
const CANDIDATE_LIMIT = 8;
const PROMPT_CANDIDATES = 3;
const DECISIONS: readonly string[] = ['add', 'supersede', 'noop'];
const tracer = trace.getTracer('workflow');

interface Candidate { id: string; score: number; text: string; type: MemoryItemType; subjects: readonly string[]; observedAt?: string; held: boolean; }
const stillValid = (record: MemoryItem, expected: MemoryItem): boolean => record.stableDefinitionId === expected.stableDefinitionId && record.ownerId === expected.ownerId && (record.expiresAt === undefined || Date.parse(record.expiresAt) > Date.now());

const mayRetire = (decision: 'supersede' | 'noop', type: MemoryItemType, target: Candidate): boolean => {
  if (decision === 'supersede' && target.held) return false;
  return target.type === type || (decision === 'supersede' ? target.type === 'run-summary' : type === 'run-summary');
};

export class MemoryConsolidator {
  constructor(private readonly store: WorkflowStore, private readonly memory: HostedMemoryPort, private readonly model: ConsolidationPort) {}

  async decide(tenantId: string, runId: string, item: WorkflowRecord<MemoryItem>, text: string): Promise<ConsolidationRecord> {
    const stored = await this.store.workerRead<ConsolidationRecord>(tenantId, 'memory-consolidation', item.id);
    if (stored) return stored.data;
    return tracer.startActiveSpan('workflow.memory.consolidate', { attributes: { tenant_id: tenantId, 'workflow.run_id': runId } }, async (span) => {
      try {
        const candidates = await this.candidates(tenantId, runId, item, text);
        const record = await this.route(tenantId, runId, item, text, candidates);
        span.setAttribute('memory.consolidation.path', record.path);
        let won = true;
        const written = await this.store.workerWrite(tenantId, 'memory-consolidation', item.id, 0, record.decision, record).catch(async (error: unknown) => {
          won = false;
          const winner = await this.store.workerRead<ConsolidationRecord>(tenantId, 'memory-consolidation', item.id);
          if (!winner) throw error;
          return winner;
        });
        if (won as boolean) memoryConsolidated(tenantId, runId, record.decision, record.path, candidates.length);
        return written.data;
      } finally { span.end(); }
    });
  }

  async corroborate(tenantId: string, itemId: string, sourceId: string): Promise<void> {
    const existing = await this.store.workerRead<ConsolidationRecord>(tenantId, 'memory-consolidation', itemId);
    const seen = existing?.data.corroboratedBy ?? [];
    if (seen.includes(sourceId)) return;
    const data: ConsolidationRecord = { ...(existing?.data ?? { decision: 'add', path: 'deterministic', scores: [] }), corroboratedBy: [...seen, sourceId].slice(-20) };
    await this.store.workerWrite(tenantId, 'memory-consolidation', itemId, existing?.version ?? 0, existing?.state ?? 'add', data);
  }

  private async candidates(tenantId: string, runId: string, item: WorkflowRecord<MemoryItem>, text: string): Promise<Candidate[]> {
    const leading = item.data.subjects?.[0];
    try {
      const matches = await this.memory.query(namespace(tenantId), text, CANDIDATE_LIMIT, { state: 'promoted', stableDefinitionId: item.data.stableDefinitionId, ...(leading ? { subjects: { contains: leading } } : {}) });
      const records = await Promise.all(matches.filter((match) => match.id !== item.id).map(async (match) => ({ match, record: await this.store.workerRead<MemoryItem>(tenantId, 'memory-item', match.id) })));
      return records.flatMap(({ match, record }): Candidate[] => record && record.state === 'promoted' && !record.data.sourceId.includes(runId) && stillValid(record.data, item.data) && record.data.sourceDigest === match.metadata.sourceDigest
        ? [{ id: record.id, score: match.score, text: match.text, type: record.data.type, subjects: record.data.subjects ?? [], ...(record.data.observedAt ?? record.data.promotedAt ? { observedAt: record.data.observedAt ?? record.data.promotedAt } : {}), held: record.data.hold === true }]
        : []).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
    } catch (error) { report(error, { site: 'runtime.memory-consolidation-query', tenantId }); return []; }
  }

  private async route(tenantId: string, runId: string, item: WorkflowRecord<MemoryItem>, text: string, candidates: readonly Candidate[]): Promise<ConsolidationRecord> {
    const scores = candidates.map((candidate) => ({ id: candidate.id, score: candidate.score }));
    const band = candidates.filter((candidate) => candidate.score >= CONSOLIDATE_MIN);
    if (band.length === 0) return { decision: 'add', path: 'deterministic', scores };
    const subjects = item.data.subjects ?? [];
    const duplicate = band.find((candidate) => candidate.score >= DUPLICATE_MIN && candidate.type === item.data.type && sameSubjects(candidate.subjects, subjects));
    if (duplicate) return { decision: 'noop', targetId: duplicate.id, path: 'deterministic', scores };
    return this.ask(tenantId, runId, item, text, band.slice(0, PROMPT_CANDIDATES), scores);
  }

  private async ask(tenantId: string, runId: string, item: WorkflowRecord<MemoryItem>, text: string, band: readonly Candidate[], scores: ConsolidationRecord['scores']): Promise<ConsolidationRecord> {
    const fallback: ConsolidationRecord = { decision: 'add', path: 'fallback', scores };
    if (!this.model.consolidate) return fallback;
    try {
      const answer = await this.model.consolidate({ tenantId, runId, item: { text, ...(item.data.observedAt ? { observedAt: item.data.observedAt } : {}) }, candidates: band.map((candidate) => ({ id: candidate.id, text: candidate.text, ...(candidate.observedAt ? { observedAt: candidate.observedAt } : {}) })) });
      const target = band.find((candidate) => candidate.id === answer.targetId);
      const decision = DECISIONS.includes(answer.decision) ? answer.decision as ConsolidationDecision : 'add';
      const meta = { model: answer.model, promptVersion: answer.promptVersion };
      if (decision === 'add' || !target || !mayRetire(decision, item.data.type, target)) return { decision: 'add', path: 'model', scores, ...meta };
      return { decision, targetId: target.id, path: 'model', scores, ...meta };
    } catch (error) { report(error, { site: 'runtime.memory-consolidation', tenantId }); return fallback; }
  }
}
