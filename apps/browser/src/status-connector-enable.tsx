import { useState } from 'react';
import { certifiedStatusInstallation, statusConnectorEndpoint } from '../../../packages/workflow/src/commit-status-connector.js';
import { failureNotice } from './error-view.js';
import type { PlatformApi } from './platform-api.js';

interface Props { api: PlatformApi; tenantId: string; enabledEndpoints: readonly string[]; onEnabled: () => Promise<void>; }

export function StatusConnectorEnable({ api, tenantId, enabledEndpoints, onEnabled }: Props) {
  const [message, setMessage] = useState<string>();
  const endpoint = statusConnectorEndpoint(api.publicOrigin);
  const enabled = enabledEndpoints.includes(endpoint);

  const enable = async () => {
    try {
      await api.command({ tenantId, owner: 'workflow', name: 'certify', expectedVersion: 0, arguments: { id: crypto.randomUUID(), installation: await certifiedStatusInstallation(endpoint) } });
      setMessage('Commit status connector enabled. Paste a GitHub token for it under Connector tokens.');
      await onEnabled();
    } catch (error) {
      setMessage(failureNotice(error, 'The connector could not be enabled. Only an administrator can certify a connector.', { write: true }));
    }
  };

  return <section className="connector-status" aria-label="Commit status connector">
    <strong>Commit status connector</strong>
    <p className="field-help">Publishes the workflow/pr-gate commit status on GitHub, so you do not run a separate server. It uses the token you save for it.</p>
    <button className="button" disabled={enabled} onClick={() => void enable()}>{enabled ? 'Connector enabled' : 'Enable commit status connector'}</button>
    {message && <p className="field-help" role="status">{message}</p>}
  </section>;
}
