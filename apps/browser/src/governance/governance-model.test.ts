import { describe, expect, test } from 'vitest';
import { banner, dataNotes, delta, DASH, formatSeconds, kpis, scopeQuery } from './governance-model.js';
import type { Health, Kpis } from './decoders.js';

const zero = { runs: 0, completed: 0, failed: 0, unknownOutcome: 0, p95Seconds: null, tokens: 0, cost: 0 };
const empty: Kpis = { ...zero, pendingApprovals: 0, previous: zero };
const circuit = (state: 'open' | 'probe') => ({ tenantId: 't', workspace: 'w', key: 'model:x', state, since: '2026-01-01T00:00:00.000Z' });
const health = (circuits: Health['circuits']): Health => ({ connectors: [], circuits, reconciliation: [], completeness: 'full', classification: 'restricted-operational' });

describe('delta', () => {
  test('reports growth against a non-zero previous value', () => {
    expect(delta(120, 100)).toEqual({ text: '+20.0%', direction: 'up' });
  });
  test.each([[5, 0], [0, 0], [null, 5], [5, null], [Number.NaN, 5]])('returns a dash for %s vs %s', (current, previous) => {
    expect(delta(current, previous)).toEqual({ text: DASH, direction: 'none' });
  });
});

describe('kpis', () => {
  test('shows dashes, never NaN, for an overview with zero runs', () => {
    const [runs, success, p95] = kpis(empty);
    expect(success?.value).toBeNull();
    expect(p95?.value).toBeNull();
    expect(runs?.change.text).toBe(DASH);
    expect(JSON.stringify(kpis(empty))).not.toMatch(/NaN|Infinity/u);
  });
  test('returns the five tiles in order', () => {
    expect(kpis(empty).map((tile) => tile.id)).toEqual(['runs', 'success', 'p95', 'spend', 'pending']);
  });
});

describe('formatSeconds', () => {
  test('uses milliseconds under one second', () => {
    expect(formatSeconds(0.25)).toBe('250ms');
  });
});

describe('banner', () => {
  test('mentions open circuits and unconfigured telemetry', () => {
    const result = banner(health([circuit('open'), circuit('open')]), 'not-configured');
    expect(result.text).toContain('Telemetry not configured');
    expect(result.text).toContain('2 open circuits');
    expect(result.tone).toBe('warn');
  });
  test('is ok when everything is connected and quiet', () => {
    expect(banner(health([circuit('probe')]), 'ready').tone).toBe('ok');
  });
});

describe('scopeQuery', () => {
  test('omits the tenant when scope is all workspaces', () => {
    expect(scopeQuery(undefined, '7d')).toEqual({ range: '7d' });
  });
  test('includes both keys for one workspace', () => {
    expect(scopeQuery('t1', '24h')).toEqual({ range: '24h', tenant: 't1' });
  });
});

describe('dataNotes', () => {
  test('states fixture and partial data in words', () => {
    expect(dataNotes({ completeness: 'partial', classification: 'fixture' })).toHaveLength(2);
    expect(dataNotes({ completeness: 'full', classification: 'restricted-operational' }, undefined)).toEqual([]);
  });
});
