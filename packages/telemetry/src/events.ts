import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { scrub } from '../../errors/src/scrub.js';

const LOGGER_NAME = 'threadline';
const MAX_VALUE = 200;
const SEVERITY = { info: SeverityNumber.INFO, warn: SeverityNumber.WARN, error: SeverityNumber.ERROR } as const;

export const EVENTS = {
  'api.request.failed': ['tenant_id', 'route', 'method', 'status', 'code', 'category', 'correlation_id'],
  'auth.denied': ['route', 'reason'],
  'command.executed': ['tenant_id', 'owner', 'name', 'outcome', 'actor_user_id', 'object_id'],
  'run.started': ['tenant_id', 'run_id', 'definition_id', 'trigger', 'owner_id'],
  'run.finished': ['tenant_id', 'run_id', 'definition_id', 'status', 'reason', 'duration_s', 'tokens', 'cost'],
  'node.failed': ['tenant_id', 'run_id', 'node_id', 'node_kind', 'code'],
  'approval.requested': ['tenant_id', 'run_id', 'node_id', 'kind', 'capability', 'expires_at'],
  'approval.decided': ['tenant_id', 'run_id', 'decision', 'actor_user_id', 'wait_s'],
  'approval.expired': ['tenant_id', 'run_id', 'node_id'],
  'model.call': ['tenant_id', 'run_id', 'node_id', 'provider', 'model', 'attempt', 'outcome', 'tokens', 'cost', 'duration_s'],
  'mcp.call': ['tenant_id', 'run_id', 'node_id', 'capability', 'route', 'outcome', 'duration_s', 'effect_id'],
  'circuit.transition': ['tenant_id', 'kind', 'state'],
  'webhook.delivery': ['tenant_id', 'definition_id', 'outcome'],
  'connector.request': ['tenant_id', 'installation_id', 'operation', 'outcome'],
  'memory.retrieval': ['tenant_id', 'run_id', 'node_id', 'status', 'item_count'],
  'group.changed': ['group_id', 'action', 'actor_user_id', 'subject_id'],
  'assistant.asked': ['group_id', 'billing_tenant_id', 'provider', 'model', 'tokens', 'cost', 'outcome'],
} as const;

export type EventName = keyof typeof EVENTS;
export type EventLevel = keyof typeof SEVERITY;
type EventValue = string | number | boolean | undefined;

export function projectEvent(name: string, attributes: Readonly<Record<string, unknown>>): Record<string, string | number | boolean> | undefined {
  if (!Object.hasOwn(EVENTS, name)) return undefined;
  const projected: Record<string, string | number | boolean> = {};
  for (const key of EVENTS[name as EventName] as readonly string[]) {
    const value = attributes[key];
    if (typeof value === 'string') projected[key] = scrub(value, MAX_VALUE);
    else if (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) projected[key] = value;
  }
  return projected;
}

export function logEvent<Name extends EventName>(name: Name, attributes: Partial<Record<(typeof EVENTS)[Name][number], EventValue>>, level: EventLevel = 'info'): void {
  const projected = projectEvent(name, attributes);
  if (projected === undefined) return;
  logs.getLogger(LOGGER_NAME).emit({ severityNumber: SEVERITY[level], severityText: level.toUpperCase(), body: name, attributes: { ...projected, event: name, level } });
  console.log(JSON.stringify({ event: name, level, at: new Date().toISOString(), ...projected }));
}
