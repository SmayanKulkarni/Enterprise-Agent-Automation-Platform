import type { GraphDraft } from '../../../packages/workflow/src/graph.js';

export interface RevisionEntry { revision: number; state: string; digest: string; createdAt: string; graph: GraphDraft; steps: number; connections: number; tools: number; }

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isTool = (edge: unknown): boolean => record(edge) && edge['role'] === 'tool';

export function parseRevisions(records: readonly Record<string, unknown>[]): RevisionEntry[] {
  const seen = new Set<number>();
  return records.flatMap((item): RevisionEntry[] => {
    const graph = item['graph'];
    const revision = item['revision'];
    if (!record(graph) || graph['kind'] !== 'graph-v1' || !Array.isArray(graph['nodes']) || !Array.isArray(graph['edges'])) return [];
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1 || seen.has(revision)) return [];
    if (typeof item['digest'] !== 'string' || typeof item['state'] !== 'string') return [];
    seen.add(revision);
    const tools = graph['edges'].filter(isTool).length;
    return [{ revision, state: item['state'], digest: item['digest'], createdAt: typeof item['createdAt'] === 'string' ? item['createdAt'] : '', graph: graph as unknown as GraphDraft, steps: graph['nodes'].length, connections: graph['edges'].length - tools, tools }];
  }).sort((left, right) => right.revision - left.revision);
}

export function revisionTime(iso: string): string {
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? '' : value.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export const loadedNotice = (entry: RevisionEntry, head: number): string => entry.revision === head
  ? `Revision ${String(entry.revision)} loaded on the canvas.`
  : `Revision ${String(entry.revision)} loaded as an unsaved change. Saving creates revision ${String(head + 1)}; revision ${String(entry.revision)} is not changed.`;
