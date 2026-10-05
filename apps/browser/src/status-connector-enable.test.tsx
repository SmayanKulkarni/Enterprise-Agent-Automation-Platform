import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import type { PlatformApi } from './platform-api.js';
import { StatusConnectorEnable } from './status-connector-enable.js';

const render = (enabledEndpoints: string[]) => renderToStaticMarkup(<StatusConnectorEnable api={{ publicOrigin: 'https://app.example' } as PlatformApi} tenantId="t" enabledEndpoints={enabledEndpoints} onEnabled={() => Promise.resolve()} />);

test('offers to enable the connector until its endpoint is certified', () => {
  expect(render([])).toContain('Enable commit status connector');
  expect(render([])).not.toContain('disabled');
  const enabled = render(['https://app.example/api/connectors/github-status']);
  expect(enabled).toContain('Connector enabled');
  expect(enabled).toContain('disabled');
});
