import { useState } from 'react';

export const webhookDeliveryUrl = (origin: string, tenantId: string, definitionId: string): string => `${origin.replace(/\/+$/u, '')}/api/workflow-webhook/${tenantId}/${definitionId}`;

export function CopyUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
  };
  return <span>
    <label>Webhook URL<input readOnly value={url} onFocus={(event) => event.currentTarget.select()} /></label>
    <button type="button" className="button-secondary" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy URL'}</button>
  </span>;
}

export function GithubWebhookSetup({ url }: { url: string }) {
  return <section className="webhook-github" aria-label="GitHub setup">
    <strong>GitHub repository webhook</strong>
    <p className="field-help">In the repository, open Settings, then Webhooks, then Add webhook, and enter:</p>
    <ul>
      <li>Payload URL: <code>{url}</code></li>
      <li>Content type: <code>application/json</code></li>
      <li>Secret: the signing secret shown once when you provision or rotate the credential below</li>
      <li>Events: choose Let me select individual events, then tick Pull requests and Pushes</li>
    </ul>
  </section>;
}
