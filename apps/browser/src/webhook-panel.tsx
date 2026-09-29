import { useEffect, useState } from 'react';
import type { PlatformApi, Projection } from './platform-api.js';
import { failureNotice } from './error-view.js';
import { parseTriggerInput, type TriggerSchema } from './workflow-model.js';

type WebhookPanelProps = {
  api: PlatformApi;
  tenantId: string;
  definitionId: string;
  webhook: boolean;
  admin: boolean;
  schema: TriggerSchema;
  onAccepted: (runId: string) => void;
};

const testMessage = {
  accepted: 'Test event accepted.',
  'credential-state': 'Provision or rotate the signing credential before testing.',
  'invalid-shape': 'The sample event does not match the published Trigger contract.',
  signature: 'The server could not verify the test signature.',
  freshness: 'The test timestamp was rejected as stale.',
  replay: 'This event was already accepted; no duplicate Run was created.',
  'not-found': 'The published webhook Definition is unavailable.',
} as const;

export function WebhookPanel({ api, tenantId, definitionId, webhook, admin, schema, onAccepted }: WebhookPanelProps) {
  const [credentials, setCredentials] = useState<Projection>();
  const [secret, setSecret] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [acceptedRunId, setAcceptedRunId] = useState<string>();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const refresh = async () => setCredentials(await api.projection(tenantId, 'workflow-webhook-credentials'));

  useEffect(() => {
    void refresh().catch(() => setMessage('Credential status could not be loaded.'));
  }, [api, tenantId]);

  if (!webhook) return null;

  const credential = credentials?.records.find((item) => String(item['definitionId']).toLowerCase() === definitionId.toLowerCase());
  const version = Number(credential?.['version'] ?? 0);
  const enabled = credential?.['enabled'] === true;
  const action = async (name: 'provision-webhook-credential' | 'rotate-webhook-credential' | 'disable-webhook-credential') => {
    try {
      const result = await api.command({ tenantId, owner: 'workflow', name, expectedVersion: version, arguments: { id: definitionId } });
      setSecret(result.webhookSecret);
      setMessage(result.webhookSecret ? 'Copy the signing secret now. It will not be shown again.' : 'Credential updated.');
      await refresh();
    } catch (error) {
      setMessage(failureNotice(error, 'Credential change failed.', { write: true }));
    }
  };
  const test = async () => {
    const parsed = parseTriggerInput(schema, values);
    if (parsed.errors) {
      setErrors(parsed.errors);
      return;
    }
    try {
      const result = await api.command({ tenantId, owner: 'workflow', name: 'test-webhook', expectedVersion: 0, arguments: { id: definitionId, input: parsed.input ?? {} } });
      const outcome = result.webhookTest;
      if (outcome?.outcome === 'accepted' && outcome.runId) {
        setMessage(`Test event accepted as Run ${outcome.runId}.`);
        setAcceptedRunId(outcome.runId);
        onAccepted(outcome.runId);
        return;
      }
      setAcceptedRunId(undefined);
      setMessage(testMessage[outcome?.outcome ?? 'not-found']);
    } catch (error) {
      setMessage(failureNotice(error, 'Webhook test failed.', { write: true }));
    }
  };
  const url = `${window.location.origin}/api/workflow-webhook/${tenantId}/${definitionId}`;

  return <section className="connector-panel" aria-label="Webhook connection">
    <div className="pane-heading"><div><p>Published webhook</p><h2>Signed event ingress</h2><span>Your database or event relay sends signed events to this URL. Studio does not subscribe to database changes.</span></div></div>
    <label>Webhook URL<input readOnly value={url} /></label>
    <p>Sign UTF-8 bytes of <code>{tenantId}:{definitionId}:&lt;timestamp&gt;:&lt;event-id&gt;:&lt;raw-body&gt;</code> with HMAC-SHA256. Send ISO timestamp, UUID event ID, and <code>sha256=&lt;hex&gt;</code>; timestamps expire after five minutes.</p>
    {credentials && <p>Credential: {enabled ? 'enabled' : credential ? 'disabled' : 'not configured'}{typeof credential?.['rotatedAt'] === 'string' ? ` · rotated ${credential['rotatedAt']}` : ''}</p>}
    {secret && <p className="connector-token"><strong>Signing secret</strong><code>{secret}</code></p>}
    {message && <p role="status">{message}{acceptedRunId && <> <a href={`#run-${acceptedRunId}`}>Open Run History</a></>}</p>}
    {admin && <div>
      {!credential && <button onClick={() => void action('provision-webhook-credential')}>Provision signing credential</button>}
      {credential && enabled && <><button onClick={() => void action('rotate-webhook-credential')}>Rotate signing credential</button><button onClick={() => void action('disable-webhook-credential')}>Disable credential</button></>}
      {credential && !enabled && <button onClick={() => void action('rotate-webhook-credential')}>Provision replacement credential</button>}
    </div>}
    {admin && <section>
      <strong>Test published Trigger</strong>
      {Object.entries(schema.properties).map(([name, field]) => <label key={name}>
        {name}{schema.required.includes(name) ? ' (required)' : ''}
        {field.type === 'boolean' ? <select value={String(values[name] ?? '')} aria-invalid={errors[name] !== undefined} onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value === 'true' }))}><option value="">Choose</option><option value="true">True</option><option value="false">False</option></select> : field.type === 'array' ? <textarea aria-label={`${name} items`} placeholder="One item per line" onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value.split('\n').filter(Boolean) }))} /> : field.type === 'object' ? <textarea aria-label={`${name} fields`} placeholder="One name: value per line" onChange={(event) => setValues((current) => ({ ...current, [name]: Object.fromEntries(event.target.value.split('\n').map((line) => line.split(':').map((part) => part.trim())).filter(([key]) => key)) }))} /> : <input type={field.type === 'number' ? 'number' : 'text'} value={String(values[name] ?? '')} aria-invalid={errors[name] !== undefined} onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))} />}
        {errors[name] && <span role="alert">{errors[name]}</span>}
      </label>)}
      <button type="button" className="button-secondary" onClick={() => void test()} disabled={!enabled}>Send signed test event</button>
    </section>}
    {!admin && <p>An administrator can provision, rotate, or test the signing credential.</p>}
  </section>;
}
