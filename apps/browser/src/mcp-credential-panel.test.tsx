import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { McpCredentialRow } from './mcp-credential-panel.js';

const row = (admin: boolean, record?: Record<string, unknown>) => renderToStaticMarkup(<McpCredentialRow installationId="inst-1" record={record} admin={admin} value="" onChange={() => {}} onAct={() => {}} />);

test('an administrator can paste a token and rotate or disconnect a connected one', () => {
  expect(row(true)).toContain('Connect token');
  const connected = row(true, { id: 'inst-1', enabled: true, version: 2 });
  for (const text of ['Token connected', 'Rotate token', 'Disconnect', 'type="password"']) expect(connected).toContain(text);
});

test('a non-administrator sees status only and no inputs', () => {
  const html = row(false, { id: 'inst-1', enabled: true, version: 2 });
  expect(html).toContain('Token connected');
  for (const text of ['<input', 'Rotate token', 'Disconnect', 'Connect token']) expect(html).not.toContain(text);
});
