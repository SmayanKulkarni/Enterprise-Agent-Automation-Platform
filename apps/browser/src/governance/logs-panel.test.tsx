import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { LogEntry } from './decoders.js';
import { LogList } from './logs-panel.js';

const entry = (attributes: LogEntry['attributes'], overrides: Partial<LogEntry> = {}): LogEntry => ({ at: '2026-01-01T10:00:00.000Z', event: 'run.started', level: 'info', attributes, ...overrides });
const render = (entries: readonly LogEntry[], status: 'ready' | 'not-configured' | 'unavailable' = 'ready') => renderToStaticMarkup(<LogList entries={entries} status={status} names={{ t1: 'Support' }} openTrace={() => undefined} />);

describe('LogList', () => {
  test('renders hostile attribute values as escaped text', () => {
    const html = render([entry({ route: '<img src=x onerror=alert(1)>' })]);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('shows the workspace by name, falling back to a short id', () => {
    const html = render([entry({ tenant_id: 't1' }), entry({ tenant_id: 'a1000000-0000-4000-8000-000000000001' })]);
    expect(html).toContain('Support');
    expect(html).toContain('a1000000');
  });

  test('offers View trace only for entries that have a run id', () => {
    expect(render([entry({ run_id: 'r1' })])).toContain('View trace');
    expect(render([entry({ tenant_id: 't1' })])).not.toContain('View trace');
  });

  test('keeps rows collapsed and wired to their attribute list', () => {
    const html = render([entry({ run_id: 'r1' })]);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/aria-controls="([^"]+)"[\s\S]*<dl id="\1" hidden=""/u);
  });

  test.each([
    ['not-configured', 'Logs are not configured'],
    ['unavailable', 'Logs are unavailable'],
  ] as const)('%s renders its sentence', (status, text) => {
    expect(render([], status)).toContain(text);
  });

  test('an empty ready result says so', () => {
    expect(render([])).toContain('No log entries match');
  });
});
