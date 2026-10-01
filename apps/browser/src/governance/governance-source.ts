import { isPanel, isSqlPanel, RANGES, type PanelId } from '../../../../packages/governance/src/catalog.js';
import { buildApprovals, buildHealth } from '../../../../packages/governance/src/attention.js';
import { fixtureApprovals, fixtureHealth, fixtureOverview, fixtureSeries, fixtureWorkflows } from '../../../../packages/governance/src/fixtures.js';
import { buildOverview, buildSeries, buildWorkflows } from '../../../../packages/governance/src/reads.js';
import { decodeApprovals, decodeHealth, decodeOverview, decodeSeries, decodeWorkflows, type Approvals, type Group, type Health, type Overview, type RangeKey, type Series, type Workflows } from './decoders.js';
import type { GovernanceApi } from './governance-api.js';
import { scopeQuery } from './governance-model.js';

export interface GovernanceSource {
  readonly fixture: boolean;
  overview(range: RangeKey, scope: string | undefined, signal: AbortSignal): Promise<Overview>;
  workflows(range: RangeKey, scope: string | undefined, signal: AbortSignal): Promise<Workflows>;
  health(signal: AbortSignal): Promise<Health>;
  approvals(signal: AbortSignal): Promise<Approvals>;
  series(panel: string, range: RangeKey, scope: string | undefined, signal: AbortSignal): Promise<Series>;
}

export const FIXTURE_GROUP: Group = { id: 'fixture-group', name: 'Fixture group', epoch: 1, adminEpoch: 1, tenantIds: ['a1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002'] };

export function liveSource(api: GovernanceApi, groupId: string): GovernanceSource {
  return {
    fixture: false,
    overview: (range, scope, signal) => api.read(groupId, 'overview', scopeQuery(scope, range), decodeOverview, signal),
    workflows: (range, scope, signal) => api.read(groupId, 'workflows', scopeQuery(scope, range), decodeWorkflows, signal),
    health: (signal) => api.read(groupId, 'health', {}, decodeHealth, signal),
    approvals: (signal) => api.read(groupId, 'approvals', {}, decodeApprovals, signal),
    series: (panel, range, scope, signal) => api.read(groupId, 'series', { panel, ...scopeQuery(scope, range) }, decodeSeries, signal),
  };
}

export function fixtureSource(group: Group = FIXTURE_GROUP, now: () => number = Date.now): GovernanceSource {
  const scoped = (scope: string | undefined): string[] => group.tenantIds.filter((id) => scope === undefined || id === scope);
  const aborted = <T>(signal: AbortSignal, build: () => T): Promise<T> => signal.aborted ? Promise.reject(new DOMException('Aborted', 'AbortError')) : Promise.resolve(build());
  return {
    fixture: true,
    overview: (range, scope, signal) => aborted(signal, () => decodeOverview({ ...buildOverview(fixtureOverview(scoped(scope)), range), classification: 'fixture' })),
    workflows: (range, scope, signal) => aborted(signal, () => decodeWorkflows({ ...buildWorkflows(fixtureWorkflows(scoped(scope)), range), classification: 'fixture' })),
    health: (signal) => aborted(signal, () => decodeHealth({ ...buildHealth(fixtureHealth(group.tenantIds, now())), classification: 'fixture' })),
    approvals: (signal) => aborted(signal, () => decodeApprovals({ ...buildApprovals(fixtureApprovals(group.tenantIds, now())), classification: 'fixture' })),
    series: (panel, range, scope, signal) => aborted(signal, () => {
      const known: PanelId | undefined = isPanel(panel) ? panel : undefined;
      const base = { panel, range, completeness: 'full', classification: 'fixture' };
      if (known === undefined || !isSqlPanel(known)) return decodeSeries({ ...base, status: 'not-configured', series: [] });
      const from = now() - RANGES[range].ms;
      return decodeSeries({ ...buildSeries(known, range, fixtureSeries(scoped(scope), range, from), from), classification: 'fixture' });
    }),
  };
}
