import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { ChartPanelView, OVERVIEW_PANELS } from './chart-panel.js';
import type { Series } from './decoders.js';

const spec = OVERVIEW_PANELS[2]!;
const series = (overrides: Partial<Series>): Series => ({ panel: 'api-latency', range: '7d', status: 'ready', series: [{ label: 'p50', points: [[1, 1], [2, 2]] }], completeness: 'full', classification: 'restricted-operational', ...overrides });
const render = (state: Parameters<typeof ChartPanelView>[0]['state']) => renderToStaticMarkup(<ChartPanelView spec={spec} range="7d" state={state} />);

describe('ChartPanelView', () => {
  test.each([
    ['not-configured', 'Telemetry is not configured for this environment.'],
    ['unavailable', 'Telemetry is unavailable right now.'],
  ] as const)('%s renders its sentence and no chart', (status, sentence) => {
    const html = render({ series: series({ status, series: [] }), failed: false, loading: false });
    expect(html).toContain(sentence);
    expect(html).not.toContain('<path');
  });

  test('ready without points says there is no data', () => {
    const html = render({ series: series({ series: [{ label: 'p50', points: [] }] }), failed: false, loading: false });
    expect(html).toContain('No data in this period.');
    expect(html).not.toContain('<path');
  });

  test('partial completeness adds the retained-data note', () => {
    expect(render({ series: series({ completeness: 'partial' }), failed: false, loading: false })).toContain('Showing the data that is retained.');
  });

  test('a failed panel says so without touching the others', () => {
    expect(render({ failed: true, loading: false })).toContain('could not be loaded');
  });

  test('a ready panel draws its chart', () => {
    expect(render({ series: series({}), failed: false, loading: false })).toContain('<path');
  });
});
