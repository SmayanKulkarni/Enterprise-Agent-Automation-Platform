import { Component, cloneElement, useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react';

export function Field({ label, help, error, children }: { label: string; help?: string | undefined; error?: string | undefined; children: ReactElement }) {
  const id = useId();
  const describedBy = [help && `${id}-help`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  const extra: { 'aria-describedby'?: string; 'aria-invalid'?: boolean } = {};
  if (describedBy !== undefined) extra['aria-describedby'] = describedBy;
  if (error) extra['aria-invalid'] = true;
  return <label className="field"><span>{label}</span>{cloneElement(children, extra)}{help && <small id={`${id}-help`} className="field-help">{help}</small>}{error && <small id={`${id}-error`} className="field-error" role="alert">{error}</small>}</label>;
}

export function Dialog({ labelledBy, onClose, className, children }: { labelledBy: string; onClose: () => void; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.showModal();
    return () => opener?.focus();
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
