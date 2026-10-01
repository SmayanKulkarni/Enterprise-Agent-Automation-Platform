import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { scrub } from '../../errors/src/scrub.js';
import { EVENTS } from './event-names.js';

const LOGGER_NAME = 'threadline';
const MAX_VALUE = 200;
const SEVERITY = { info: SeverityNumber.INFO, warn: SeverityNumber.WARN, error: SeverityNumber.ERROR } as const;

export { EVENTS };

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
