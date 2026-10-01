import { describe, expect, test } from 'vitest';
import { PlatformApiError } from '../platform-api.js';
import { addableWorkspaces, approvalCommand, banner, commandFailure, shortId, dataNotes, decisionFailure, delta, DASH, formatSeconds, kpis, scopeQuery, timeLeft } from './governance-model.js';
import type { Approval, Health, Kpis } from './decoders.js';

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

describe('timeLeft', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z');
  const at = (ms: number) => new Date(now + ms).toISOString();
  test.each([[30_000, 'under a minute'], [12 * 60_000, '12 min'], [(3 * 60 + 5) * 60_000, '3 h 5 min'], [2 * 3_600_000, '2 h']])('%i ms is %s', (ms, text) => {
    expect(timeLeft(at(ms), now)).toEqual({ text, expired: false });
  });
  test('a past time and a bad time are expired', () => {
    expect(timeLeft(at(-1000), now)).toEqual({ text: 'Expired', expired: true });
    expect(timeLeft('nonsense', now).expired).toBe(true);
  });
});

describe('approvalCommand', () => {
  const row: Approval = { tenantId: 't1', workspace: 'w', runId: 'r1', runVersion: 7, workflowName: 'wf', revision: 1, nodeId: 'n', kind: 'tool', capability: 'c', installationId: 'i', target: 'x', arguments: [], argumentsDigest: 'a'.repeat(64), expiresAt: '2026-01-01T00:00:00.000Z', bindingDigest: 'b'.repeat(64) };
  test('targets the existing workflow approve command with the row version and digest', () => {
    expect(approvalCommand(row, 'reject')).toEqual({ tenantId: 't1', owner: 'workflow', name: 'approve', expectedVersion: 7, arguments: { id: 'r1', bindingDigest: 'b'.repeat(64), decision: 'reject' } });
  });
});

describe('decisionFailure', () => {
  test('maps a 409 to conflict and a network error to unknown', () => {
    expect(decisionFailure(new PlatformApiError(409))).toBe('conflict');
    expect(decisionFailure(new TypeError('Failed to fetch'))).toBe('unknown');
    expect(decisionFailure(new PlatformApiError(403))).toBe('denied');
    expect(decisionFailure(new PlatformApiError(422))).toBe('failed');
  });
});

describe('addableWorkspaces', () => {
  const tenants = [{ id: 'a', profiles: ['admin'], epoch: 1 }, { id: 'b', profiles: ['operator'], epoch: 1 }, { id: 'c', profiles: ['admin', 'editor'], epoch: 1 }];

  test('excludes workspaces the user does not administer and ones already in the group', () => {
    const group = { id: 'g', name: 'G', epoch: 1, adminEpoch: 1, tenantIds: ['c'] };
    expect(addableWorkspaces(tenants, group)).toEqual(['a']);
  });
});

describe('commandFailure', () => {
  const failure = (status: number) => new PlatformApiError(status);

  test.each([
    [failure(409), 'add-tenant', 2, 'The group changed since you loaded it. It has been reloaded.'],
    [failure(409), 'remove-admin', 1, 'A group must keep at least one admin.'],
    [failure(409), 'remove-admin', 2, 'The group changed since you loaded it. It has been reloaded.'],
    [failure(403), 'add-tenant', 2, "Only a workspace's own admin can add it to a group."],
    [failure(403), 'create-group', 2, "Only a workspace's own admin can add it to a group."],
    [failure(403), 'remove-tenant', 2, "You can't change this group."],
    [failure(422), 'add-admin', 2, 'That request was not valid.'],
    [failure(500), 'add-admin', 2, 'The change could not be saved. Try again.'],
  ] as const)('%#: maps status and command to a sentence', (error, name, admins, text) => {
    expect(commandFailure(error, name, admins)).toBe(text);
  });
});

describe('shortId', () => {
  test('keeps the first eight characters', () => {
    expect(shortId('a1000000-0000-4000-8000-000000000001')).toBe('a1000000');
  });
});
