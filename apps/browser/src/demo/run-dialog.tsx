import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DemoRun } from '../../../../packages/workflow/src/pr-gate-demo.js';
import { Dialog, Field, Notice } from '../ui.js';
import { DemoApiError, requestDemoRun } from './demo-api.js';

interface Props { onClose: () => void; onRun: (run: DemoRun) => void }

const PAIR_ERROR = 'Fill in both the token and the pull request address, or leave both empty to use the sample pull request.';
const GENERIC_ERROR = 'The demo could not be reached. Try again in a moment.';

export function RunDialog({ onClose, onRun }: Props) {
  const [token, setToken] = useState('');
  const [pullRequest, setPullRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; used: boolean }>();
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controller.current?.abort(), []);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const githubToken = token.trim();
    const address = pullRequest.trim();
    if ((githubToken === '') !== (address === '')) { setProblem({ text: PAIR_ERROR, used: false }); return; }
    const next = new AbortController();
    controller.current = next;
    setBusy(true);
    setProblem(undefined);
    requestDemoRun(githubToken === '' ? {} : { githubToken, pullRequest: address }, next.signal)
      .then(onRun)
      .catch((error: unknown) => {
        if (next.signal.aborted) return;
        setProblem(error instanceof DemoApiError ? { text: error.message, used: error.code === 'DEMO_RUN_USED' } : { text: GENERIC_ERROR, used: false });
        setBusy(false);
      });
  };

  return <Dialog labelledBy="demo-run-title" onClose={busy ? () => undefined : onClose} className="demo-dialog">
    <form onSubmit={submit}>
      <h2 id="demo-run-title">Start the demo run</h2>
      <Notice tone="warning"><strong>Rate limited: one run per IP address.</strong> After this run, this address cannot start another.</Notice>
      <p>The workflow runs on the server with no model calls and none of the owner's credentials. By default it reviews a built-in sample pull request, then waits for a human decision, as it would in production.</p>
      <details className="demo-own-pr">
        <summary>Use my own GitHub pull request (optional)</summary>
        <Field label="GitHub token" help="Read access to the pull request is enough. It is sent once to read the pull request and is never stored or logged."><input type="password" autoComplete="off" spellCheck={false} value={token} onChange={(event) => setToken(event.target.value)} /></Field>
        <Field label="Pull request address" help="For example https://github.com/owner/repo/pull/12."><input type="url" autoComplete="off" spellCheck={false} value={pullRequest} onChange={(event) => setPullRequest(event.target.value)} /></Field>
      </details>
      {problem !== undefined && <Notice tone="danger">{problem.text}</Notice>}
      <div className="dialog-actions">
        <button type="button" className="button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className="button" disabled={busy || problem?.used === true}>{busy ? 'Starting…' : 'Start workflow'}</button>
      </div>
    </form>
  </Dialog>;
}
