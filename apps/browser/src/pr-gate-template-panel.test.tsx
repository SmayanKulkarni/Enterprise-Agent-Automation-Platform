import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import type { PlatformApi, Projection } from './platform-api.js';
import { PrGateTemplatePanel, suggestedInstallation } from './pr-gate-template-panel.js';

const record = (id: string, names: string[], health = 'healthy') => ({ id, health, manifest: { certified: true, capabilities: names.map((name) => ({ name })) } });
const installations = { records: [record('github-1', ['pull_request_read', 'merge_pull_request']), record('status-1', ['create_commit_status']), record('down-1', ['create_commit_status'], 'offline')] } as unknown as Projection;
const render = (admin: boolean) => renderToStaticMarkup(<PrGateTemplatePanel api={{} as PlatformApi} tenantId="t" admin={admin} installations={installations} onCreated={() => Promise.resolve()} />);

test('suggests the healthy certified installation that offers the capability', () => {
  expect(suggestedInstallation(installations, 'pull_request_read')).toBe('github-1');
  expect(suggestedInstallation(installations, 'create_commit_status')).toBe('status-1');
  expect(suggestedInstallation(installations, 'nothing')).toBe('');
  expect(suggestedInstallation(undefined, 'pull_request_read')).toBe('');
});

test('an administrator sees the preselected connectors and the create button', () => {
  const html = render(true);
  for (const text of ['PR gate', 'Create PR gate draft', 'github-1', 'status-1']) expect(html).toContain(text);
  expect(html).not.toContain('down-1');
});

test('a non-administrator cannot create the draft', () => {
  const html = render(false);
  expect(html).not.toContain('Create PR gate draft');
  expect(html).toContain('An administrator can create');
});
