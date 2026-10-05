import { expect, test } from 'vitest';
import { PROMETHEUS_PANELS, type PrometheusPanelId } from './catalog.js';
import { tenantMatcher } from './scope.js';

const matcher = tenantMatcher(['11111111-1111-4111-8111-111111111111']);
const panels = Object.keys(PROMETHEUS_PANELS) as PrometheusPanelId[];

test('has the ten telemetry panels', () => {
  expect(panels).toHaveLength(10);
});

test('judgment-bands counts questions by band for the tenant only', () => {
  const [query] = PROMETHEUS_PANELS['judgment-bands'](matcher, 300, 86_400);

  expect(query).toEqual({ label: 'questions', query: `sum by (band) (increase(workflow_judgment_bands_total{${matcher}}[300s]))`, by: ['band'] });
});

test.each(panels)('%s injects the matcher into every selector and is deterministic', (panel) => {
  const queries = PROMETHEUS_PANELS[panel](matcher, 300, 86_400);

  expect(queries.length).toBeGreaterThan(0);
  for (const { query } of queries) {
    const selectors = [...query.matchAll(/\{([^}]*)\}/gu)].map((match) => match[1] ?? '');
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) expect(selector).toContain(matcher);
  }
  expect(PROMETHEUS_PANELS[panel](matcher, 300, 86_400)).toEqual(queries);
});

test('writes the rate window and the range in plain seconds', () => {
  expect(PROMETHEUS_PANELS['api-throughput'](matcher, 60, 3600)[0]?.query).toContain('[300s]');
  expect(PROMETHEUS_PANELS['api-throughput'](matcher, 10_800, 2_592_000)[0]?.query).toContain('[10800s]');
  expect(PROMETHEUS_PANELS['circuit-transitions'](matcher, 300, 86_400)[0]?.query).toContain('[86400s]');
});
