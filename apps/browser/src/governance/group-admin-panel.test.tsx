import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { Group, Members } from './decoders.js';
import { GroupAdminPanel } from './group-admin-panel.js';

const group: Group = { id: 'g1', name: 'Ops', epoch: 3, adminEpoch: 1, tenantIds: ['t1', 't2'] };
const members: Members = {
  workspaces: [{ tenantId: 't1', name: 'support', joinedAt: '2026-01-02T00:00:00.000Z', billing: true }, { tenantId: 't2', name: 'finance', joinedAt: '2026-01-03T00:00:00.000Z', billing: false }],
  admins: [{ userId: 'u1', name: 'Ada' }, { userId: 'u2', name: 'Bo' }],
  eligible: [{ userId: 'u3', name: 'Cy' }],
};
const tenants = [{ id: 't1', profiles: ['admin'], epoch: 1 }, { id: 't9', profiles: ['admin'], epoch: 1 }, { id: 't8', profiles: ['viewer'], epoch: 1 }];
const render = (extra: Partial<Parameters<typeof GroupAdminPanel>[0]> = {}) => renderToStaticMarkup(<GroupAdminPanel group={group} members={members} tenants={tenants} run={() => undefined} busy={false} notice={undefined} readOnly={false} {...extra} />);
const unlocked = (html: string) => (html.match(/<(?:button|select)\b(?![^>]*disabled="")/gu) ?? []).length;

describe('GroupAdminPanel', () => {
  test('lists workspaces with a billing marker and admins by name', () => {
    const html = render();
    for (const text of ['support', 'finance', 'Billing', 'Ada', 'Bo']) expect(html).toContain(text);
  });

  test('offers only administered workspaces outside the group and the eligible people', () => {
    const html = render();
    expect(html).toContain('>t9<');
    expect(html).not.toContain('>t8<');
    expect(html).toContain('Cy');
  });

  test('disables add workspace with the reason at 50 workspaces', () => {
    const many = Array.from({ length: 50 }, (_, index) => ({ tenantId: `t${String(index)}`, name: `w${String(index)}`, joinedAt: '2026-01-02T00:00:00.000Z', billing: index === 0 }));
    const html = render({ members: { ...members, workspaces: many } });
    expect(html).toContain('A group can have at most 50 workspaces.');
  });

  test('disables add admin with the reason at 20 admins', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ userId: `u${String(index)}`, name: `p${String(index)}` }));
    expect(render({ members: { ...members, admins: many } })).toContain('A group can have at most 20 admins.');
  });

  test('disables the last admin remove control with the reason', () => {
    const html = render({ members: { ...members, admins: [{ userId: 'u1', name: 'Ada' }] } });
    expect(html).toContain('A group must keep at least one admin.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Remove<span class="visually-hidden"> Ada/u);
  });

  test.each([['readOnly', { readOnly: true }], ['busy', { busy: true }]])('%s leaves no enabled write control', (_label, extra) => {
    expect(unlocked(render(extra))).toBe(0);
  });

  test('shows the notice', () => {
    expect(render({ notice: { tone: 'warning', text: 'The group changed since you loaded it. It has been reloaded.' } })).toContain('The group changed');
  });

  test('renders hostile names as text', () => {
    const html = render({ members: { ...members, admins: [{ userId: 'u1', name: '<img src=x onerror=alert(1)>' }, { userId: 'u2', name: 'Bo' }] } });
    expect(html).not.toContain('<img');
  });
});
