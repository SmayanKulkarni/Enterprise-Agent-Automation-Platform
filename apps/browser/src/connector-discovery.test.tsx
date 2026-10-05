import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ConnectorDiscovery } from './connector-discovery.js';
import type { PlatformApi } from './platform-api.js';

test('starts with an endpoint and a password-type token field and no certify button until tools are found', () => {
  const html = renderToStaticMarkup(<ConnectorDiscovery api={{} as PlatformApi} tenantId="t" installationId="" onInstallationId={() => {}} onCertified={() => Promise.resolve()} />);
  for (const text of ['Discover tools', 'Endpoint', 'type="password"', 'Leave blank to use the saved token']) expect(html).toContain(text);
  expect(html).not.toContain('Certify discovered tools');
});
