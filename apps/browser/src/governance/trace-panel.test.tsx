import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { Span, Trace } from './decoders.js';
import { TraceView } from './trace-panel.js';

const span = (overrides: Partial<Span>): Span => ({ traceId: 'T', spanId: 'a', name: 'Webhook received', startMs: 1000, durationMs: 1000, status: 'ok', attributes: {}, ...overrides });
const trace = (spans: readonly Span[], status: Trace['status'] = 'ready'): Trace => ({ run: 'r', status, spans, completeness: 'full', classification: 'restricted-operational' });
const render = (value: Trace) => renderToStaticMarkup(<TraceView trace={value} />);

describe('TraceView', () => {
  const three = [span({}), span({ spanId: 'b', parentSpanId: 'a', name: 'Plan', startMs: 1500, durationMs: 500, status: 'error' }), span({ spanId: 'c', name: 'Apply', startMs: 2000, durationMs: 0 })];

  test('renders a row per span with computed percentages and no other inline style', () => {
    const html = render(trace(three));
    expect(html.match(/<li/gu)).toHaveLength(3);
    expect(html).toContain('left:50%;width:50%');
    expect(html).toContain('left:0%;width:100%');
    expect(html.match(/style="/gu)).toHaveLength(3);
  });

  test('marks error spans and names rows for assistive technology', () => {
    const html = render(trace(three));
    expect(html).toContain('Error');
    expect(html).toContain('aria-label="Plan, 500 ms, starts at +500 ms, error"');
  });

  test('summarises span count, total duration and errors', () => {
    const html = render(trace(three));
    for (const text of ['3', '1 s', '1']) expect(html).toContain(text);
  });

  test('renders span names as escaped text', () => {
    expect(render(trace([span({ name: '<b>x</b>' })]))).not.toContain('<b>x');
  });

  test.each([
    ['not-configured', 'Tracing is not configured'],
    ['unavailable', 'Tracing is unavailable'],
  ] as const)('%s renders its sentence', (status, text) => {
    expect(render(trace([], status))).toContain(text);
  });

  test('an empty ready result says so', () => {
    expect(render(trace([]))).toContain('no spans');
  });
});
