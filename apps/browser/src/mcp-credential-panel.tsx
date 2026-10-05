import { useEffect, useState } from 'react';
import { failureNotice } from './error-view.js';
import type { PlatformApi, Projection } from './platform-api.js';

type Action = 'connect' | 'rotate' | 'disconnect';

interface RowProps {
  installationId: string;
  record: Record<string, unknown> | undefined;
  admin: boolean;
  value: string;
  onChange: (value: string) => void;
  onAct: (action: Action) => void;
}

export function McpCredentialRow({ installationId, record, admin, value, onChange, onAct }: RowProps) {
  const connected = record?.['enabled'] === true;
  return <div className="connector-credential">
    <span>{installationId} · {connected ? 'Token connected' : 'No token'}</span>
    {admin && <>
      <label className="field">Access token
        <input type="password" autoComplete="off" aria-label={`Access token for ${installationId}`} value={value} onChange={(event) => onChange(event.target.value)} />
      </label>
      <button className="button-secondary" disabled={value === ''} onClick={() => onAct(connected ? 'rotate' : 'connect')}>{connected ? 'Rotate token' : 'Connect token'}</button>
      {connected && <button className="button-secondary" onClick={() => onAct('disconnect')}>Disconnect</button>}
    </>}
  </div>;
}

export function McpCredentialPanel({ api, tenantId, installationIds, admin }: { api: PlatformApi; tenantId: string; installationIds: readonly string[]; admin: boolean }) {
  const [status, setStatus] = useState<Projection>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();

  const refresh = async () => setStatus(await api.projection(tenantId, 'workflow-mcp-credentials'));
  useEffect(() => { setValues({}); setMessage(undefined); void refresh().catch(() => setMessage('Token status could not be loaded.')); }, [api, tenantId]);

  const act = async (installationId: string, action: Action) => {
    const record = status?.records.find((item) => item['id'] === installationId);
    try {
      await api.command({ tenantId, owner: 'workflow', name: `${action}-mcp-credential`, expectedVersion: Number(record?.['version'] ?? 0), arguments: action === 'disconnect' ? { id: installationId } : { id: installationId, key: values[installationId] ?? '' } });
      setValues((current) => ({ ...current, [installationId]: '' }));
      setMessage(action === 'disconnect' ? 'Token disconnected.' : 'Token saved. It is stored encrypted and cannot be shown again.');
      await refresh();
    } catch (error) {
      setMessage(failureNotice(error, 'The token could not be saved. Only an administrator can manage connector tokens.', { write: true }));
    }
  };

  if (installationIds.length === 0) return null;
  return <section className="connector-credentials" aria-label="Connector tokens">
    <strong>Connector tokens</strong>
    {message && <p className="field-help" role="status">{message}</p>}
    {installationIds.map((installationId) => <McpCredentialRow key={installationId} installationId={installationId} record={status?.records.find((item) => item['id'] === installationId)} admin={admin} value={values[installationId] ?? ''} onChange={(value) => setValues((current) => ({ ...current, [installationId]: value }))} onAct={(action) => void act(installationId, action)} />)}
  </section>;
}
