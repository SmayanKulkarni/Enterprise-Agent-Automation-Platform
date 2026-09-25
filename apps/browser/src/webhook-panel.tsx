import { useEffect, useState } from 'react';
import type { PlatformApi, Projection } from './platform-api.js';

export function WebhookPanel({ api, tenantId, definitionId, webhook, admin }: { api: PlatformApi; tenantId: string; definitionId: string; webhook: boolean; admin: boolean }) {
  const [credentials, setCredentials] = useState<Projection>();
  const [secret, setSecret] = useState<string>();
  const [message, setMessage] = useState<string>();
  const refresh = async () => setCredentials(await api.projection(tenantId, 'workflow-webhook-credentials'));
  useEffect(() => { void refresh().catch(() => setMessage('Credential status could not be loaded.')); }, [api, tenantId]);
  if (!webhook) return null;
  const credential = credentials?.records.find((item) => item['definitionId'] === definitionId);
  const version = Number(credential?.['version'] ?? 0);
  const enabled = credential?.['enabled'] === true;
  const action = async (name: 'provision-webhook-credential' | 'rotate-webhook-credential' | 'disable-webhook-credential') => {
    try {
      const result = await api.command({ tenantId, owner: 'workflow', name, expectedVersion: version, arguments: { id: definitionId } });
      setSecret(result.webhookSecret); setMessage(result.webhookSecret ? 'Copy the signing secret now. It will not be shown again.' : 'Credential updated.'); await refresh();
    } catch { setMessage('Credential change was denied or stale. Refresh and retry.'); }
  };
  const url = `${window.location.origin}/api/workflow-webhook/${tenantId}/${definitionId}`;
  return <section className="connector-panel" aria-label="Webhook connection"><div className="pane-heading"><div><p>Published webhook</p><h2>Signed event ingress</h2><span>Your database or event relay sends signed events to this URL. Studio does not subscribe to database changes.</span></div></div><label>Webhook URL<input readOnly value={url} /></label><p>Sign UTF-8 bytes of <code>{tenantId}:{definitionId}:&lt;timestamp&gt;:&lt;event-id&gt;:&lt;raw-body&gt;</code> with HMAC-SHA256. Send ISO timestamp, UUID event ID, and <code>sha256=&lt;hex&gt;</code>; timestamps expire after five minutes.</p>{credentials && <p>Credential: {enabled ? 'enabled' : credential ? 'disabled' : 'not configured'}{typeof credential?.['rotatedAt'] === 'string' ? ` · rotated ${credential['rotatedAt']}` : ''}</p>}{secret && <p className="connector-token"><strong>Signing secret</strong><code>{secret}</code></p>}{message && <p role="status">{message}</p>}{admin && <div>{!credential && <button onClick={() => void action('provision-webhook-credential')}>Provision signing credential</button>}{credential && enabled && <><button onClick={() => void action('rotate-webhook-credential')}>Rotate signing credential</button><button onClick={() => void action('disable-webhook-credential')}>Disable credential</button></>}{credential && !enabled && <button onClick={() => void action('rotate-webhook-credential')}>Provision replacement credential</button>}</div>}{!admin && <p>An administrator can provision or rotate the signing credential.</p>}</section>;
}
