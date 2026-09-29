import { useRef } from 'react';
import { gsap, motionAllowed, useGSAP } from './motion.js';
import { revisionTime, type RevisionEntry } from './revision-history.js';
import { Notice } from './ui.js';

export type RevisionLoadState = 'loading' | 'ready' | 'failed';

interface RevisionHistoryProps { entries: readonly RevisionEntry[]; state: RevisionLoadState; head: number; canSave: boolean; onLoad: (entry: RevisionEntry) => void; onRetry: () => void; onSave: () => void; }

const count = (value: number, noun: string): string => `${String(value)} ${noun}${value === 1 ? '' : 's'}`;

export function RevisionHistory({ entries, state, head, canSave, onLoad, onRetry, onSave }: RevisionHistoryProps) {
  const root = useRef<HTMLElement>(null);
  useGSAP(() => {
    if (state === 'ready' && motionAllowed()) gsap.fromTo('.revision-item', { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: .3, stagger: .04, ease: 'power2.out', clearProps: 'transform,opacity' });
  }, { scope: root, dependencies: [state, entries.length, head] });
  return <section className="studio-pane revision-history" id="studio-panel-versions" role="tabpanel" aria-labelledby="studio-tab-versions" ref={root}>
    <div className="pane-heading"><div><p>Governed history</p><h2>Versions</h2><span>Every saved revision of this draft, from any device in this workspace. Loading one puts it on the canvas as an unsaved change; saving creates the next revision and never rewrites history.</span></div><button className="button" onClick={onSave} disabled={!canSave}>Save revision</button></div>
    {head === 0 && <p className="field-help" role="status">No revision is saved yet. Save the canvas to create revision 1.</p>}
    {head > 0 && state === 'loading' && <p className="field-help" role="status" aria-busy="true">Loading revisions…</p>}
    {head > 0 && state === 'failed' && <Notice tone="danger">Revisions couldn't be loaded. The canvas is unchanged. <button className="inline-link" onClick={onRetry}>Retry</button></Notice>}
    {head > 0 && state === 'ready' && entries.length === 0 && <p className="field-help" role="status">This draft has no readable revisions.</p>}
    {entries.length > 0 && state !== 'failed' && <ol className="revision-list" aria-label="Saved revisions">{entries.map((entry) => <li key={entry.revision} className="revision-item" data-current={entry.revision === head ? 'true' : undefined}>
      <div className="revision-main"><strong>Revision {entry.revision}</strong>{entry.revision === head && <span className="status-pill ok">Latest</span>}<span className="status-pill">{entry.state}</span></div>
      <div className="revision-meta"><span>{count(entry.steps, 'step')}</span><span>{count(entry.connections, 'connection')}</span><span>{count(entry.tools, 'tool edge')}</span>{revisionTime(entry.createdAt) && <time dateTime={entry.createdAt}>{revisionTime(entry.createdAt)}</time>}<code title={entry.digest}>{entry.digest.slice(0, 12)}</code></div>
      <button className="button-secondary" onClick={() => onLoad(entry)} aria-label={`Load revision ${String(entry.revision)} onto the canvas`}>Load revision {entry.revision}</button>
    </li>)}</ol>}
  </section>;
}
