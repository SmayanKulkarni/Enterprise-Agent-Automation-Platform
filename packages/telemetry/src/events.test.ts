import { logs } from '@opentelemetry/api-logs';
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { EVENTS, logEvent, projectEvent } from './events.js';

let stdout: { mock: { calls: unknown[][] } } & (() => void);
beforeEach(() => { stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); logs.disable(); });

const lines = (): Record<string, unknown>[] => stdout.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);

test('drops an attribute outside the event allowlist', () => {
  logEvent('auth.denied', { route: '/api/v1/session', reason: 'DENIED', tenant_id: 'not-allowed' } as never);

  expect(lines()).toEqual([{ event: 'auth.denied', level: 'info', at: expect.any(String) as string, route: '/api/v1/session', reason: 'DENIED' }]);
});

test('scrubs a bearer token inside a string value and cuts the value to 200 characters', () => {
  logEvent('auth.denied', { reason: 'saw Bearer abc.def.ghi today' });
  logEvent('auth.denied', { reason: 'x'.repeat(500) });

  expect(JSON.stringify(lines()[0])).not.toContain('abc.def.ghi');
  expect(lines()[0]?.['reason']).toBe('saw [redacted] today');
  expect(String(lines()[1]?.['reason'])).toHaveLength(200);
});

test.each([[Infinity], [-Infinity], [NaN]])('drops the non-finite number %s', (value) => {
  logEvent('run.finished', { duration_s: value, tokens: 12 });

  expect(lines()[0]).toMatchObject({ tokens: 12 });
  expect(lines()[0]).not.toHaveProperty('duration_s');
});

test('keeps booleans and drops objects, arrays, null and undefined', () => {
  logEvent('memory.retrieval', { status: true, item_count: 0, run_id: { nested: 1 }, node_id: ['a'], tenant_id: null, } as never);

  expect(lines()[0]).toMatchObject({ status: true, item_count: 0 });
  expect(lines()[0]).not.toHaveProperty('run_id');
  expect(lines()[0]).not.toHaveProperty('node_id');
  expect(lines()[0]).not.toHaveProperty('tenant_id');
});

test('writes exactly one stdout line per event with the level', () => {
  logEvent('api.request.failed', { status: 500, code: 'INTERNAL' }, 'error');

  expect(stdout).toHaveBeenCalledTimes(1);
  expect(lines()[0]).toMatchObject({ event: 'api.request.failed', level: 'error', status: 500, code: 'INTERNAL' });
});

test('emits an OpenTelemetry log record whose body is the event name', () => {
  const exporter = new InMemoryLogRecordExporter();
  logs.setGlobalLoggerProvider(new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter })] }));
  logEvent('circuit.transition', { tenant_id: 't1', kind: 'model', state: 'open', extra: 'dropped' } as never, 'warn');

  const [record] = exporter.getFinishedLogRecords();
  expect(record?.body).toBe('circuit.transition');
  expect(record?.severityText).toBe('WARN');
  expect(record?.attributes).toEqual({ tenant_id: 't1', kind: 'model', state: 'open', event: 'circuit.transition', level: 'warn' });
});

test.each([['unknown.event'], ['constructor'], ['__proto__'], ['toString'], ['']])('projectEvent returns undefined for the name %j', (name) => {
  expect(projectEvent(name, { tenant_id: 't1' })).toBeUndefined();
});

test('logEvent writes nothing for a name outside the catalog', () => {
  logEvent('unknown.event' as never, { tenant_id: 't1' });

  expect(stdout).not.toHaveBeenCalled();
});

test('no allowlist uses a key the record itself carries', () => {
  for (const keys of Object.values(EVENTS)) expect(keys.filter((key) => ['event', 'level', 'at'].includes(key))).toEqual([]);
});
