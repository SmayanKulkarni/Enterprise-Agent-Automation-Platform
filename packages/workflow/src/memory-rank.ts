import type { MemoryItem, MemoryItemType } from './memory.js';

export interface RankInputs { score: number; recency: number; typeWeight: number; }
export interface RankedMemory<Match> { match: Match; id: string; item: MemoryItem; inputs: RankInputs; rank: number; }

export const RANK_WEIGHTS = { score: 0.65, recency: 0.25, type: 0.1 } as const;
export const RECENCY_HALF_LIFE_DAYS: Record<MemoryItemType, number | undefined> = { 'task-fact': 30, 'run-summary': 14, 'stated-preference': undefined };
export const TYPE_WEIGHTS: Record<MemoryItemType, number> = { 'stated-preference': 1, 'task-fact': 0.9, 'run-summary': 0.6 };
export const LEGACY_TYPE_WEIGHT = 0.3;
export const MAX_ITEMS_PER_SUBJECT = 2;
const OVERFETCH_FACTOR = 3;
const OVERFETCH_CAP = 30;
const QUERY_DEPTH = 4;
const DAY_MS = 86400000;
const PRECISION = 1e6;

export const overfetch = (limit: number): number => Math.min(limit * OVERFETCH_FACTOR, OVERFETCH_CAP);

export const rankInputs = (item: MemoryItem, score: number, now: number): RankInputs => {
  const halfLife = RECENCY_HALF_LIFE_DAYS[item.type];
  const observed = Date.parse(item.observedAt ?? item.promotedAt ?? '');
  const recency = halfLife === undefined ? 1 : Number.isNaN(observed) ? 0 : 0.5 ** (Math.max(0, now - observed) / DAY_MS / halfLife);
  return { score, recency, typeWeight: item.schemaVersion === undefined ? LEGACY_TYPE_WEIGHT : TYPE_WEIGHTS[item.type] };
};

export const rankValue = (inputs: RankInputs): number => RANK_WEIGHTS.score * inputs.score + RANK_WEIGHTS.recency * inputs.recency + RANK_WEIGHTS.type * inputs.typeWeight;

const observedMs = (item: MemoryItem): number => { const time = Date.parse(item.observedAt ?? ''); return Number.isNaN(time) ? 0 : time; };

export const orderRanked = <Match>(entries: readonly RankedMemory<Match>[]): RankedMemory<Match>[] => [...entries].sort((left, right) => right.rank - left.rank || observedMs(right.item) - observedMs(left.item) || left.id.localeCompare(right.id));

export const capPerSubject = <Match>(entries: readonly RankedMemory<Match>[]): RankedMemory<Match>[] => {
  const seen = new Map<string, number>();
  return entries.filter((entry) => {
    const lead = entry.item.subjects?.[0]; if (lead === undefined) return true;
    const used = seen.get(lead) ?? 0; seen.set(lead, used + 1);
    return used < MAX_ITEMS_PER_SUBJECT;
  });
};

export const receiptInputs = (inputs: RankInputs): RankInputs => ({ score: Math.round(inputs.score * PRECISION) / PRECISION, recency: Math.round(inputs.recency * PRECISION) / PRECISION, typeWeight: inputs.typeWeight });

export const memoryLabel = (item: MemoryItem, id: string): string => `[${item.type} ${id} observed:${(item.observedAt ?? item.promotedAt ?? 'unknown').slice(0, 10)} subjects:${item.subjects?.length ? item.subjects.join(',') : 'none'} source:${item.sourceId}]`;

export const memoryQueryFromInput = (input: Record<string, unknown>, limit: number): string => {
  const strings: string[] = [];
  const collect = (value: unknown, depth: number): void => {
    if (typeof value === 'string') strings.push(value.trim());
    else if (depth < QUERY_DEPTH && value !== null && typeof value === 'object') { for (const child of Object.values(value)) collect(child, depth + 1); }
  };
  collect(input, 0);
  return strings.filter(Boolean).join(' ').slice(0, limit) || JSON.stringify(input).slice(0, limit);
};
