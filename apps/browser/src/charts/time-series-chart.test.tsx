import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { StackedBars } from './stacked-bars.js';
import { TimeSeriesChart } from './time-series-chart.js';

const series = [{ label: 'p50', points: [[1000, 1], [2000, 2]] as const }, { label: 'p95', points: [[1000, 3], [2000, 4]] as const }];
const lines = (html: string) => (html.match(/<path /gu) ?? []).length;

describe('TimeSeriesChart', () => {
  const html = renderToStaticMarkup(<TimeSeriesChart title="API latency" series={series} unit="seconds" range="1h" />);

  test('draws one path per series', () => {
    expect(lines(html)).toBe(2);
  });
  test('labels the chart, the legend and the series', () => {
    expect(html).toContain('aria-label="API latency"');
    expect(html).toMatch(/<li>.*p50.*<\/li><li>.*p95/su);
  });
  test('gives different series different dash patterns', () => {
    expect(html).toContain('stroke-dasharray="none"');
    expect(html).toContain('stroke-dasharray="6 3"');
  });
  test('carries the same numbers in a visually hidden table', () => {
    const table = /<table>.*<\/table>/su.exec(html)?.[0] ?? '';
    expect(table).toContain('<caption>API latency</caption>');
    expect(table).toContain('1s');
    expect(table).toContain('4s');
  });
  test('draws no path for an empty series list', () => {
    expect(lines(renderToStaticMarkup(<TimeSeriesChart title="x" series={[]} unit="count" range="7d" />))).toBe(0);
  });
  test('renders a single point as a dot, not a line', () => {
    const single = renderToStaticMarkup(<TimeSeriesChart title="x" series={[{ label: 'a', points: [[5, 5]] }]} unit="count" range="7d" />);
    expect(single).toContain('chart-dot');
    expect(single).not.toMatch(/NaN|Infinity/u);
  });
  test('uses theme tokens for colour', () => {
    expect(html).toContain('stroke="var(--chart-1)"');
  });
  test('renders series labels as text', () => {
    const tricky = renderToStaticMarkup(<TimeSeriesChart title="x" series={[{ label: '<img src=x>', points: [[1, 1], [2, 2]] }]} unit="count" range="7d" />);
    expect(tricky).toContain('&lt;img src=x&gt;');
  });
});

describe('StackedBars', () => {
  test('draws a rect per non-zero value and a hidden table', () => {
    const html = renderToStaticMarkup(<StackedBars title="Runs" series={[{ label: 'completed', points: [[1, 2], [2, 0]] }, { label: 'failed', points: [[1, 1], [2, 3]] }]} unit="count" range="24h" />);
    expect((html.match(/<rect /gu) ?? []).length).toBe(3 + 2);
    expect(html).toContain('<caption>Runs</caption>');
  });
});
