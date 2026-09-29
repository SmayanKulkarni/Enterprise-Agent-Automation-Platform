import { Component, cloneElement, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { errorView, type ErrorViewKind } from './error-view.js';
import { gsap, motionAllowed } from './motion.js';
import { errorRef } from './platform-api.js';

export function Field({ label, help, error, children }: { label: string; help?: string | undefined; error?: string | undefined; children: ReactElement }) {
  const id = useId();
  const describedBy = [help && `${id}-help`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  const extra: { 'aria-describedby'?: string; 'aria-invalid'?: boolean } = {};
  if (describedBy !== undefined) extra['aria-describedby'] = describedBy;
  if (error) extra['aria-invalid'] = true;
  return <label className="field"><span>{label}</span>{cloneElement(children, extra)}{help && <small id={`${id}-help`} className="field-help">{help}</small>}{error && <small id={`${id}-error`} className="field-error" role="alert">{error}</small>}</label>;
}

const kindIconPaths: Record<string, string> = {
  trigger: 'M7 4.5l12 7.5-12 7.5z',
  agent: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z',
  condition: 'M12 3l9 9-9 9-9-9z',
  approval: 'M9 12l2 2 4-4M12 3a9 9 0 100 18 9 9 0 000-18z',
  mcp: 'M7 8h12l-3-3M17 16H5l3 3',
  memory: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  end: 'M6.5 6.5h11v11h-11z',
  skill: 'M13 2L4 14h7l-1 8 9-12h-7z',
  retriever: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  http: 'M7 17L17 7M9 7h8v8',
  webhook: 'M12 10.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM6 6a8.5 8.5 0 000 12M18 6a8.5 8.5 0 010 12',
};

export const kindLabels: Record<string, string> = { trigger: 'Trigger', agent: 'Agent', condition: 'Condition', approval: 'Approval', skill: 'Skill', memory: 'Memory', retriever: 'Retriever', mcp: 'MCP tool', http: 'HTTP', webhook: 'Webhook', end: 'End' };

export function KindIcon({ kind }: { kind: string }) {
  return <i className="kind-icon" data-kind={kind} aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={kindIconPaths[kind] ?? kindIconPaths['end']} /></svg></i>;
}

export function Dialog({ labelledBy, onClose, className, children }: { labelledBy: string; onClose: () => void; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    dialog?.showModal();
    if (dialog && motionAllowed()) gsap.fromTo(dialog, { y: 14, opacity: 0, scale: .97 }, { y: 0, opacity: 1, scale: 1, duration: .24, ease: 'power3.out', clearProps: 'transform,opacity' });
    return () => { if (dialog) gsap.killTweensOf(dialog); opener?.focus(); };
  }, []);
  return <dialog ref={ref} className={className} aria-labelledby={labelledBy} onCancel={(event) => { event.preventDefault(); onClose(); }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>{children}</dialog>;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'success' | 'warning' | 'danger'; children: ReactNode }) {
  return <div className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>{children}</div>;
}

export function moveTabFocus(event: ReactKeyboardEvent<HTMLElement>) {
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
  const index = tabs.indexOf(document.activeElement as HTMLElement);
  const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined;
  if (next === undefined) return;
  event.preventDefault();
  const tab = tabs[(next + tabs.length) % tabs.length];
  tab?.focus();
  tab?.click();
}

export function StatePage({ title, children, actions, busy = false }: { title: string; children: ReactNode; actions?: ReactNode; busy?: boolean }) {
  return <section className="state-page" aria-busy={busy || undefined}><h1>{title}</h1><p>{children}</p>{actions && <div className="state-actions">{actions}</div>}</section>;
}

export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() {
    return this.state.failed ? <StatePage title="Something went wrong" actions={<><button className="button" onClick={() => location.reload()}>Reload</button><a className="button-secondary" href="/">Home</a></>}>This page stopped working. Reloading usually fixes it; nothing was sent on your behalf.</StatePage> : this.props.children;
  }
}

const glyphPaths: Record<ErrorViewKind, string> = {
  'signed-out': 'M7 11V8a5 5 0 0110 0v3M5 11h14v9H5z',
  denied: 'M7 11V8a5 5 0 0110 0v3M5 11h14v9H5zM12 14.5v2',
  'not-found': 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4M8.5 8.5l5 5M13.5 8.5l-5 5',
  conflict: 'M20 11a8 8 0 00-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0014.5 4.5L20 16M20 20v-4h-4',
  invalid: 'M12 3l9 16H3zM12 10v4M12 17v.5',
  'rate-limited': 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  unknown: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1-1.5 2M12 17v.5',
  unavailable: 'M4 8a12 12 0 0116 0M7 12a7 7 0 0110 0M10 16a2.5 2.5 0 014 0M12 20v.01M4 4l16 16',
  timeout: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  'not-ready': 'M13 2L4 14h7l-1 8 9-12h-7z',
};

const softKinds: readonly ErrorViewKind[] = ['signed-out', 'denied', 'not-found', 'conflict', 'invalid', 'not-ready'];

function RefChip({ reference }: { reference: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { void navigator.clipboard?.writeText(reference).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }, () => undefined); };
  return <button type="button" className="ref-chip" onClick={copy} aria-label={`Copy support reference ${reference}`}><span>Ref</span><code>{reference}</code><span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span></button>;
}

export function ErrorPage({ error, message, actions, onRetry, write = false }: { error: unknown; message?: string; actions?: ReactNode; onRetry?: () => void; write?: boolean }) {
  const view = errorView(error, { write });
  const reference = errorRef(error);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element || !motionAllowed()) return;
    const tween = gsap.fromTo(element.children, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: .45, stagger: .07, ease: 'power3.out', clearProps: 'transform,opacity' });
    return () => { tween.kill(); };
  }, [view.kind]);
  return <section ref={root} className="state-page error-page" role="alert" data-tone={softKinds.includes(view.kind) ? 'soft' : 'danger'}>
    <i className="error-glyph" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={glyphPaths[view.kind]} /></svg></i>
    <h1>{view.title}</h1>
    <p>{message ?? view.message}</p>
    {reference !== undefined && <RefChip reference={reference} />}
    {(actions || (view.retryable && onRetry)) && <div className="state-actions">{view.retryable && onRetry && <button className="button" onClick={onRetry}>Try again</button>}{actions}</div>}
  </section>;
}
