import { useState } from 'react';
import { failureNotice } from './error-view.js';
import type { PlatformApi, Projection } from './platform-api.js';

interface Props { api: PlatformApi; tenantId: string; admin: boolean; installations: Projection | undefined; onCreated: (draftId: string) => Promise<void>; }

const certified = (installations: Projection | undefined): readonly Record<string, unknown>[] => (installations?.records ?? []).filter((item) => item['health'] === 'healthy' && (item['manifest'] as { certified?: boolean } | undefined)?.certified === true);
const offers = (item: Record<string, unknown>, capability: string): boolean => ((item['manifest'] as { capabilities?: readonly { name?: string }[] } | undefined)?.capabilities ?? []).some((entry) => entry.name === capability);

export const suggestedInstallation = (installations: Projection | undefined, capability: string): string => String(certified(installations).find((item) => offers(item, capability))?.['id'] ?? '');

export function PrGateTemplatePanel({ api, tenantId, admin, installations, onCreated }: Props) {
  const [github, setGithub] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [issues, setIssues] = useState<readonly { path: string; message: string }[]>([]);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const choices = certified(installations);
  const githubId = github ?? suggestedInstallation(installations, 'pull_request_read');
  const statusId = status ?? suggestedInstallation(installations, 'create_commit_status');

  const create = async () => {
    setBusy(true); setIssues([]); setMessage(undefined);
    try {
      const draftId = crypto.randomUUID();
      const receipt = await api.command({ tenantId, owner: 'workflow', name: 'instantiate-pr-gate', expectedVersion: 0, arguments: { id: draftId, githubInstallationId: githubId, statusInstallationId: statusId } });
      if (receipt.state === 'failed') { setIssues(receipt.issues ?? []); setMessage('The draft was not created. Fix the items below and try again.'); return; }
      setIssues(receipt.issues ?? []);
      setMessage(receipt.issues?.length ? 'The draft was created but the check found problems.' : 'PR gate draft created and checked. Open it in the canvas, then publish.');
      await onCreated(draftId);
    } catch (error) {
      setMessage(failureNotice(error, 'The draft could not be created. Only an administrator can create a PR gate.', { write: true }));
    } finally { setBusy(false); }
  };

  const select = (label: string, value: string, set: (value: string) => void) => <label className="field">{label}
    <select aria-label={label} value={value} onChange={(event) => set(event.target.value)}>
      <option value="">Select certified installation</option>
      {choices.map((item) => <option key={String(item['id'])} value={String(item['id'])}>{String(item['id'])}</option>)}
    </select>
  </label>;

  return <section className="connector-panel" aria-label="PR gate template">
    <div className="pane-heading"><div><p>Template</p><h2>PR gate</h2><span>A GitHub pull request starts a reviewer agent. A human approves the merge or the return issue, and a commit status reports the outcome.</span></div></div>
    {select('GitHub connector', githubId, setGithub)}
    {select('Commit status connector', statusId, setStatus)}
    {admin ? <button className="button" disabled={busy || githubId === '' || statusId === ''} onClick={() => void create()}>Create PR gate draft</button> : <p className="field-help">An administrator can create a PR gate from this template.</p>}
    {message && <p className="field-help" role="status">{message}</p>}
    {issues.length > 0 && <ul role="alert">{issues.map((issue, index) => <li key={`${issue.path}-${String(index)}`}>{issue.message}</li>)}</ul>}
  </section>;
}
