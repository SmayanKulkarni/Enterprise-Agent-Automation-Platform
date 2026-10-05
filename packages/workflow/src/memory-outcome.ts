import { canonicalJson, digest } from '../../contracts/src/index.js';
import { normalizeSubjects, redacted, redactedDeep } from './memory.js';
import type { WorkflowRun } from './service.js';

export interface OutcomeFinding { text: string; sourceNodeId: string; excerpt: string; }
export interface OutcomeDraft { salient: boolean; subjects: string[]; outcome: string; findings: OutcomeFinding[]; status: string; }
export interface OutcomeEvidence { input: string; outputs: Record<string, string>; path: { nodeId: string; kind: string; state: string; branch?: string }[]; decisions: { nodeId: string; outcome: string }[]; status: string; label?: string; }
export type GroundedOutcome =
  | { state: 'skipped' }
  | { state: 'ungrounded' | 'rejected'; dropped: number }
  | { state: 'staged'; text: string; subjects: string[]; sources: string[]; findings: OutcomeFinding[]; dropped: number };

const INPUT_CAP = 4000;
const NODE_OUTPUT_CAP = 2000;
const OUTPUTS_CAP = 8000;
const PATH_CAP = 200;
const TEXT_CAP = 300;
const FINDINGS_CAP = 5;
const RECORD_CAP = 1000;
const EVIDENCE_KINDS = ['agent', 'mcp', 'end'];
const HIDDEN_FIELDS = ['memoryProposalIds', 'evidenceComplete'];

const squash = (value: string): string => value.replace(/\s+/gu, ' ').trim();
const sentence = (value: string): string => squash(value).replace(/[.\s]+$/u, '');
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown, max: number): value is string => typeof value === 'string' && squash(value).length > 0 && value.length <= max;

export const completedAt = (run: WorkflowRun): string => run.history.at(-1)?.at ?? new Date().toISOString();

export const outcomeEvidence = (run: WorkflowRun): OutcomeEvidence => {
  const nodes = [...new Set(run.history.filter((item) => item.state === 'completed' && EVIDENCE_KINDS.includes(item.kind)).map((item) => item.nodeId))];
  const outputs: Record<string, string> = {}; let used = 0;
  for (const nodeId of nodes) {
    const output = Object.fromEntries(Object.entries(run.outputs[nodeId] ?? {}).filter(([key]) => !HIDDEN_FIELDS.includes(key)));
    if (Object.keys(output).length === 0 || used >= OUTPUTS_CAP) continue;
    const text = canonicalJson(redactedDeep(output)).slice(0, Math.min(NODE_OUTPUT_CAP, OUTPUTS_CAP - used));
    outputs[nodeId] = text; used += text.length;
  }
  const last = run.history.at(-1);
  return {
    input: canonicalJson(redactedDeep(run.input)).slice(0, INPUT_CAP),
    outputs,
    path: run.history.slice(0, PATH_CAP).map((item) => ({ nodeId: item.nodeId, kind: item.kind, state: item.state, ...(item.kind === 'condition' && (item.detail === 'true' || item.detail === 'false') ? { branch: item.detail } : {}) })),
    decisions: Object.entries(run.decisions ?? {}).map(([nodeId, decision]) => ({ nodeId, outcome: decision.outcome })),
    status: run.status,
    ...(last && last.state !== 'completed' && last.detail ? { label: redacted(last.detail).slice(0, 100) } : {}),
  };
};

export const parseOutcomeDraft = (value: unknown): OutcomeDraft => {
  if (!isRecord(value) || typeof value['salient'] !== 'boolean' || !Array.isArray(value['subjects']) || typeof value['outcome'] !== 'string' || !Array.isArray(value['findings']) || typeof value['status'] !== 'string') throw new Error('INVALID_SUMMARY');
  const findings = value['findings'].map((entry): OutcomeFinding => {
    if (!isRecord(entry) || typeof entry['text'] !== 'string' || typeof entry['sourceNodeId'] !== 'string' || typeof entry['excerpt'] !== 'string') throw new Error('INVALID_SUMMARY');
    return { text: entry['text'], sourceNodeId: entry['sourceNodeId'], excerpt: entry['excerpt'] };
  });
  return { salient: value['salient'], subjects: value['subjects'].filter((entry): entry is string => typeof entry === 'string'), outcome: value['outcome'], findings, status: value['status'] };
};

export const composeOutcomeText = (subjects: readonly string[], outcome: string, findings: readonly OutcomeFinding[]): string => {
  const body = `${[outcome, ...findings.map((finding) => finding.text)].map(sentence).filter(Boolean).join('. ')}.`;
  return (subjects.length ? `${subjects.join(', ')}: ${body}` : body).slice(0, RECORD_CAP);
};

export const groundOutcome = (run: WorkflowRun, draft: OutcomeDraft): GroundedOutcome => {
  if (!draft.salient) return { state: 'skipped' };
  if (!isText(draft.outcome, TEXT_CAP)) throw new Error('INVALID_SUMMARY');
  const inputText = canonicalJson(run.input);
  const completed = new Set(run.history.filter((item) => item.state === 'completed').map((item) => item.nodeId));
  const evidenceOf = (nodeId: string): string => { const output = run.outputs[nodeId]; return output && Object.keys(output).length > 0 ? canonicalJson(output) : inputText; };
  const considered = draft.findings.slice(0, FINDINGS_CAP);
  const findings = considered.filter((finding) => isText(finding.text, TEXT_CAP) && isText(finding.excerpt, TEXT_CAP) && completed.has(finding.sourceNodeId) && evidenceOf(finding.sourceNodeId).includes(finding.excerpt));
  const dropped = draft.findings.length - findings.length;
  const outcome = squash(draft.outcome);
  if (findings.length === 0 && ![inputText, ...Object.values(run.outputs).map((output) => canonicalJson(output))].some((text) => text.includes(outcome))) return { state: 'ungrounded', dropped };
  const subjects = normalizeSubjects(draft.subjects);
  const text = composeOutcomeText(subjects, outcome, findings);
  if (redacted(text) !== text || findings.some((finding) => redacted(finding.excerpt) !== finding.excerpt)) return { state: 'rejected', dropped };
  return { state: 'staged', text, subjects, sources: [...new Set(findings.map((finding) => finding.sourceNodeId))], findings, dropped };
};

export const outcomeDigest = async (run: WorkflowRun, evidence: OutcomeEvidence, findings: readonly OutcomeFinding[]): Promise<string> => digest({ runId: run.id, inputDigest: run.inputDigest, outputsDigest: await digest(evidence.outputs), findings: findings.map((finding) => [finding.sourceNodeId, finding.excerpt]) });
