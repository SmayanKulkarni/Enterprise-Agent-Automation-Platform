import { useEffect, useState } from 'react';
import { Dialog, Notice } from '../ui.js';
import type { Approval, Completeness } from './decoders.js';
import { timeLeft } from './governance-model.js';
import { formatMoment } from '../charts/scale.js';

const TICK_MS = 1000;
const DIGEST_PREFIX = 12;

export interface InboxNotice { tone: 'success' | 'warning' | 'danger'; text: string }
interface Props {
  approvals: readonly Approval[];
  completeness: Completeness;
  decide: (row: Approval, decision: 'approve' | 'reject') => void;
  busyRunId: string | undefined;
  notice: InboxNotice | undefined;
  canDecide: boolean;
  now?: number;
}

function useClock(fixed: number | undefined): number {
  const [now, setNow] = useState(fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined) return;
    const timer = window.setInterval(() => { setNow(Date.now()); }, TICK_MS);
    return () => { window.clearInterval(timer); };
  }, [fixed]);
  return fixed ?? now;
}

function Card({ row, now, busy, canDecide, decide, askReject }: { row: Approval; now: number; busy: boolean; canDecide: boolean; decide: Props['decide']; askReject: (row: Approval) => void }) {
  const left = timeLeft(row.expiresAt, now);
  const disabled = busy || left.expired || !canDecide;
  return (
    <article className="approval-card" aria-busy={busy}>
      <header>
        <div><h3>{row.runLabel ?? row.workflowName}</h3><p>{row.runLabel ? `${row.workflowName} · ` : ''}{row.workspace} · revision {row.revision} · {row.kind === 'tool' ? 'Tool call' : 'Approval step'}</p></div>
        <span className={left.expired ? 'status-warn' : 'approval-left'}>{left.expired ? <><i />Expired</> : `${left.text} left`}</span>
      </header>
      <dl>
        <div><dt>Capability</dt><dd>{row.capability}</dd></div>
        <div><dt>Target</dt><dd>{row.target}</dd></div>
        <div><dt>Installation</dt><dd>{row.installationId}</dd></div>
        <div><dt>Node</dt><dd>{row.nodeId}</dd></div>
        <div><dt>Run</dt><dd>{row.runId}</dd></div>
        {row.requestedAt !== undefined && <div><dt>Requested</dt><dd>{formatMoment(Date.parse(row.requestedAt))}</dd></div>}
        <div><dt>Arguments</dt><dd>{row.arguments.length === 0 ? 'none' : row.arguments.map((argument) => `${argument.name}: ${argument.type}`).join(', ')}</dd></div>
        <div><dt>Arguments digest</dt><dd>{row.argumentsDigest.slice(0, DIGEST_PREFIX)}…</dd></div>
      </dl>
      {row.facts.length > 0 && <section className="approval-facts" aria-label="Details to review">{row.facts.map((fact) => <div key={fact.name}><h4>{fact.name}</h4><pre>{fact.value}</pre></div>)}</section>}
      <footer>
        <button className="button button-small" disabled={disabled} onClick={() => { decide(row, 'approve'); }}>Approve</button>
        <button className="button-secondary button-small" disabled={disabled} onClick={() => { askReject(row); }}>Reject</button>
        {!canDecide && <small>Sign in to decide</small>}
      </footer>
    </article>
  );
}

export function ApprovalsInbox({ approvals, completeness, decide, busyRunId, notice, canDecide, now }: Props) {
  const clock = useClock(now);
  const [confirming, setConfirming] = useState<Approval>();
  return (
    <section className="approvals-inbox" aria-label="Pending approvals">
      {notice !== undefined && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {completeness === 'partial' && <Notice tone="warning">More approvals are waiting than are shown here.</Notice>}
      {approvals.length === 0 ? <p className="card-empty">No approvals are waiting.</p> : approvals.map((row) => <Card key={`${row.tenantId}:${row.runId}`} row={row} now={clock} busy={busyRunId === row.runId} canDecide={canDecide} decide={decide} askReject={setConfirming} />)}
      {confirming !== undefined && (
        <Dialog labelledBy="reject-title" onClose={() => { setConfirming(undefined); }} className="reject-dialog">
          <h2 id="reject-title">Reject this approval?</h2>
          <p>{confirming.runLabel ?? confirming.workflowName} will not run <strong>{confirming.capability}</strong> against <strong>{confirming.target}</strong>.</p>
          <div className="dialog-actions">
            <button className="button" onClick={() => { const row = confirming; setConfirming(undefined); decide(row, 'reject'); }}>Reject</button>
            <button className="button-secondary" onClick={() => { setConfirming(undefined); }}>Cancel</button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
