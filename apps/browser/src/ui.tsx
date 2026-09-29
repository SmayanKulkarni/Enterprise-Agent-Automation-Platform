import { Component, cloneElement, useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { gsap, motionAllowed } from './motion.js';

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
