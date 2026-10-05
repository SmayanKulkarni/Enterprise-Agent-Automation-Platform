import { PlatformApiError } from '../platform-api.js';

export type Completeness = 'full' | 'partial';
export type Classification = 'fixture' | 'restricted-operational';
export type RangeKey = '1h' | '24h' | '7d' | '30d';
export type SeriesStatus = 'ready' | 'not-configured' | 'unavailable';

export interface Group { id: string; name: string; epoch: number; adminEpoch: number; tenantIds: readonly string[]; billingTenantId?: string }
export interface Totals { runs: number; completed: number; failed: number; unknownOutcome: number; p95Seconds: number | null; tokens: number; cost: number }
export interface Kpis extends Totals { pendingApprovals: number; previous: Totals }
export interface WorkspaceKpis extends Kpis { tenantId: string; name: string }
export interface Overview { range: RangeKey; workspaces: readonly WorkspaceKpis[]; total: Kpis; completeness: Completeness; classification: Classification }
export interface Workflow { tenantId: string; workspace: string; definitionId: string; name: string; runs: number; successRate: number | null; p95Seconds: number | null; cost: number }
export interface Workflows { range: RangeKey; workflows: readonly Workflow[]; completeness: Completeness; classification: Classification }
export interface Health {
  connectors: readonly { tenantId: string; workspace: string; healthy: number; offline: number; revoked: number }[];
  circuits: readonly { tenantId: string; workspace: string; key: string; state: 'open' | 'probe'; since: string }[];
  reconciliation: readonly { tenantId: string; workspace: string; runId: string; since: string }[];
  completeness: Completeness; classification: Classification;
}
export interface SeriesLine { label: string; points: readonly (readonly [number, number])[] }
export interface Series { panel: string; range: RangeKey; status: SeriesStatus; series: readonly SeriesLine[]; completeness: Completeness; classification: Classification }
export interface Approval {
  tenantId: string; workspace: string; runId: string; runVersion: number; workflowName: string; runLabel?: string; revision: number; nodeId: string; kind: 'step' | 'tool';
  capability: string; installationId: string; target: string; arguments: readonly { name: string; type: string }[]; facts: readonly { name: string; value: string }[]; argumentsDigest: string; requestedAt?: string; expiresAt: string; bindingDigest: string;
}
export interface Person { userId: string; name: string }
export interface Members { workspaces: readonly { tenantId: string; name: string; joinedAt: string; billing: boolean }[]; admins: readonly Person[]; eligible: readonly Person[] }
export type Attributes = Readonly<Record<string, string | number | boolean>>;
export interface LogEntry { at: string; event: string; level: 'info' | 'warn' | 'error'; attributes: Attributes }
export interface Logs { range: RangeKey; status: SeriesStatus; entries: readonly LogEntry[]; continuation?: { cursor: string }; completeness: Completeness; classification: Classification }
export interface Span { traceId: string; spanId: string; parentSpanId?: string; name: string; startMs: number; durationMs: number; status: 'ok' | 'error' | 'unset'; attributes: Attributes }
export interface Trace { run: string; status: SeriesStatus; spans: readonly Span[]; completeness: Completeness; classification: Classification }
export interface Approvals { approvals: readonly Approval[]; count: number; completeness: Completeness; classification: Classification }

const DIGEST = /^[0-9a-f]{64}$/u;
const malformed = (): never => { throw new PlatformApiError(500); };

export const obj = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : malformed();
export const list = (value: unknown): unknown[] => Array.isArray(value) ? value : malformed();
export const str = (value: unknown): string => typeof value === 'string' && value.length > 0 ? value : malformed();
export const num = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : malformed();
export const int = (value: unknown): number => Number.isSafeInteger(value) ? value as number : malformed();
const nullableNum = (value: unknown): number | null => value === null ? null : num(value);
const oneOf = <T extends string>(allowed: readonly T[], value: unknown): T => allowed.find((item) => item === value) ?? malformed();
const completeness = (body: Record<string, unknown>): Completeness => oneOf(['full', 'partial'], body['completeness']);
const classification = (body: Record<string, unknown>): Classification => oneOf(['fixture', 'restricted-operational'], body['classification']);
const range = (body: Record<string, unknown>): RangeKey => oneOf(['1h', '24h', '7d', '30d'], body['range']);

export function decodeGroups(value: unknown): readonly Group[] {
  return list(obj(value)['groups']).map((entry) => {
    const group = obj(entry);
    const billing = group['billingTenantId'];
    return { id: str(group['id']), name: str(group['name']), epoch: int(group['epoch']), adminEpoch: int(group['adminEpoch']), tenantIds: list(group['tenantIds']).map(str), ...(billing === undefined ? {} : { billingTenantId: str(billing) }) };
  });
}

function totals(value: unknown): Totals {
  const row = obj(value);
  return { runs: int(row['runs']), completed: int(row['completed']), failed: int(row['failed']), unknownOutcome: int(row['unknownOutcome']), p95Seconds: nullableNum(row['p95Seconds']), tokens: int(row['tokens']), cost: num(row['cost']) };
}

function kpis(value: unknown): Kpis {
  const row = obj(value);
  return { ...totals(row), pendingApprovals: int(row['pendingApprovals']), previous: totals(row['previous']) };
}

export function decodeOverview(value: unknown): Overview {
  const body = obj(value);
  return {
    range: range(body), total: kpis(body['total']), completeness: completeness(body), classification: classification(body),
    workspaces: list(body['workspaces']).map((entry) => ({ ...kpis(entry), tenantId: str(obj(entry)['tenantId']), name: str(obj(entry)['name']) })),
  };
}

export function decodeWorkflows(value: unknown): Workflows {
  const body = obj(value);
  return {
    range: range(body), completeness: completeness(body), classification: classification(body),
    workflows: list(body['workflows']).map((entry) => {
      const row = obj(entry);
      return { tenantId: str(row['tenantId']), workspace: str(row['workspace']), definitionId: str(row['definitionId']), name: str(row['name']), runs: int(row['runs']), successRate: nullableNum(row['successRate']), p95Seconds: nullableNum(row['p95Seconds']), cost: num(row['cost']) };
    }),
  };
}

export function decodeHealth(value: unknown): Health {
  const body = obj(value);
  return {
    completeness: completeness(body), classification: classification(body),
    connectors: list(body['connectors']).map((entry) => { const row = obj(entry); return { tenantId: str(row['tenantId']), workspace: str(row['workspace']), healthy: int(row['healthy']), offline: int(row['offline']), revoked: int(row['revoked']) }; }),
    circuits: list(body['circuits']).map((entry) => { const row = obj(entry); return { tenantId: str(row['tenantId']), workspace: str(row['workspace']), key: str(row['key']), state: oneOf(['open', 'probe'], row['state']), since: str(row['since']) }; }),
    reconciliation: list(body['reconciliation']).map((entry) => { const row = obj(entry); return { tenantId: str(row['tenantId']), workspace: str(row['workspace']), runId: str(row['runId']), since: str(row['since']) }; }),
  };
}

export function decodeSeries(value: unknown): Series {
  const body = obj(value);
  return {
    panel: str(body['panel']), range: range(body), status: oneOf(['ready', 'not-configured', 'unavailable'], body['status']), completeness: completeness(body), classification: classification(body),
    series: list(body['series']).map((entry) => {
      const line = obj(entry);
      return { label: str(line['label']), points: list(line['points']).map((point): readonly [number, number] => { const pair = list(point); return [num(pair[0]), num(pair[1])]; }) };
    }),
  };
}

const bool = (value: unknown): boolean => typeof value === 'boolean' ? value : malformed();
const person = (value: unknown): Person => ({ userId: str(obj(value)['userId']), name: str(obj(value)['name']) });

export function decodeMembers(value: unknown): Members {
  const body = obj(value);
  return {
    workspaces: list(body['workspaces']).map((entry) => { const row = obj(entry); return { tenantId: str(row['tenantId']), name: str(row['name']), joinedAt: str(row['joinedAt']), billing: bool(row['billing']) }; }),
    admins: list(body['admins']).map(person),
    eligible: list(body['eligible']).map(person),
  };
}

const attributes = (value: unknown): Attributes => Object.fromEntries(Object.entries(obj(value)).map(([key, item]) => [key, typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item) ? item : malformed()]));
const nonNegative = (value: unknown): number => { const number = num(value); return number >= 0 ? number : malformed(); };
const status = (body: Record<string, unknown>): SeriesStatus => oneOf(['ready', 'not-configured', 'unavailable'], body['status']);

export function decodeLogs(value: unknown): Logs {
  const body = obj(value);
  const continuation = body['continuation'];
  return {
    range: range(body), status: status(body), completeness: completeness(body), classification: classification(body),
    entries: list(body['entries']).map((item): LogEntry => { const row = obj(item); return { at: str(row['at']), event: str(row['event']), level: oneOf(['info', 'warn', 'error'], row['level']), attributes: attributes(row['attributes']) }; }),
    ...(continuation === undefined ? {} : { continuation: { cursor: str(obj(continuation)['cursor']) } }),
  };
}

export function decodeTrace(value: unknown): Trace {
  const body = obj(value);
  return {
    run: str(body['run']), status: status(body), completeness: completeness(body), classification: classification(body),
    spans: list(body['spans']).map((item): Span => {
      const row = obj(item);
      const parent = row['parentSpanId'];
      return { traceId: str(row['traceId']), spanId: str(row['spanId']), name: str(row['name']), startMs: nonNegative(row['startMs']), durationMs: nonNegative(row['durationMs']), status: oneOf(['ok', 'error', 'unset'], row['status']), attributes: attributes(row['attributes']), ...(parent === undefined ? {} : { parentSpanId: str(parent) }) };
    }),
  };
}

export function decodeApprovals(value: unknown): Approvals {
  const body = obj(value);
  const approvals = list(body['approvals']).map((entry): Approval => {
    const row = obj(entry);
    const digest = (field: string): string => { const text = str(row[field]); return DIGEST.test(text) ? text : malformed(); };
    const requestedAt = row['requestedAt'];
    return {
      tenantId: str(row['tenantId']), workspace: str(row['workspace']), runId: str(row['runId']), runVersion: int(row['runVersion']), workflowName: str(row['workflowName']), ...(row['runLabel'] === undefined ? {} : { runLabel: str(row['runLabel']) }), revision: int(row['revision']), nodeId: str(row['nodeId']),
      kind: oneOf(['step', 'tool'], row['kind']), capability: str(row['capability']), installationId: str(row['installationId']), target: str(row['target']),
      arguments: list(row['arguments']).map((argument) => ({ name: str(obj(argument)['name']), type: str(obj(argument)['type']) })),
      facts: list(row['facts'] ?? []).map((fact) => ({ name: str(obj(fact)['name']), value: str(obj(fact)['value']) })),
      argumentsDigest: digest('argumentsDigest'), bindingDigest: digest('bindingDigest'), expiresAt: str(row['expiresAt']),
      ...(requestedAt === undefined ? {} : { requestedAt: str(requestedAt) }),
    };
  });
  return { approvals, count: int(body['count']), completeness: completeness(body), classification: classification(body) };
}

export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface AssistantRequest { messages: readonly ChatMessage[]; scope: { tenantId: string | null }; range: RangeKey; provider: 'azure-openai' | 'openrouter'; model: string; billingTenantId: string }
export interface AssistantAnswer { answer: string; model: string; tokens: number; cost: number }

export function decodeAnswer(value: unknown): AssistantAnswer {
  const body = obj(value);
  return { answer: typeof body['answer'] === 'string' ? body['answer'] : malformed(), model: str(body['model']), tokens: nonNegative(body['tokens']), cost: nonNegative(body['cost']) };
}
