import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { Kpis, Overview, Workflows } from './decoders.js';
import { kpis } from './governance-model.js';
import { KpiRow } from './kpi-row.js';
import { OverviewPanel } from './overview-panel.js';

const totals = { runs: 1234, completed: 1000, failed: 234, unknownOutcome: 0, p95Seconds: 2.5, tokens: 5000, cost: 12.5 };
const total: Kpis = { ...totals, pendingApprovals: 3, previous: totals };
const overview = (overrides: Partial<Overview> = {}): Overview => ({ range: '7d', workspaces: [{ ...total, tenantId: 't1', name: '<b>Alpha</b>' }], total, completeness: 'full', classification: 'restricted-operational', ...overrides });
const workflows = (overrides: Partial<Workflows> = {}): Workflows => ({ range: '7d', workflows: [{ tenantId: 't1', workspace: 'Alpha', definitionId: 'd1', name: 'Refund', runs: 40, successRate: 0.975, p95Seconds: 0.25, cost: 1.5 }], completeness: 'full', classification: 'restricted-operational', ...overrides });
const render = (o: Overview, w: Workflows) => renderToStaticMarkup(<OverviewPanel overview={o} workflows={w} scope={undefined} setScope={() => undefined} />);

describe('OverviewPanel', () => {
  test('shows formatted values in both tables', () => {
    const html = render(overview(), workflows());
    expect(html).toContain('1,234');
    expect(html).toContain('81.0%');
    expect(html).toContain('$12.50');
    expect(html).toContain('97.5%');
    expect(html).toContain('250ms');
  });

  test('renders workspace names as text, not markup', () => {
    expect(render(overview(), workflows())).toContain('&lt;b&gt;Alpha&lt;/b&gt;');
  });

  test('puts each workspace name in a button that sets the scope', () => {
    expect(render(overview(), workflows())).toMatch(/<th scope="row"><button[^>]*>/u);
  });

  test('says in words when data is partial', () => {
    expect(render(overview({ completeness: 'partial' }), workflows())).toContain('Partial data');
  });

  test('labels fixture data', () => {
    expect(render(overview({ classification: 'fixture' }), workflows())).toContain('Fixture data');
  });

  test('says when there is nothing to list', () => {
    const html = render(overview({ workspaces: [] }), workflows({ workflows: [] }));
    expect(html).toContain('No workspaces in this group yet.');
    expect(html).toContain('No workflow runs in this period.');
  });
});

describe('KpiRow', () => {
  test('renders a dash instead of NaN for an empty window', () => {
    const empty = { runs: 0, completed: 0, failed: 0, unknownOutcome: 0, p95Seconds: null, tokens: 0, cost: 0 };
    const html = renderToStaticMarkup(<KpiRow range="7d" tiles={kpis({ ...empty, pendingApprovals: 0, previous: empty })} />);
    expect(html).not.toMatch(/NaN|Infinity/u);
    expect(html).toContain('—');
  });
});
