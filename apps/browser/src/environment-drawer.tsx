import { useEffect, useRef, type ReactNode } from 'react';
import { gsap, motionAllowed, useGSAP } from './motion.js';

export const sectionIds = ['provider', 'models', 'connectors', 'templates', 'webhook', 'memory', 'runs'] as const;
export type SectionId = (typeof sectionIds)[number];
export interface DrawerSection { id: SectionId; label: string; hint: string; render: () => ReactNode; }

const hashSections: readonly [RegExp, SectionId][] = [
  [/^#provider-panel$/u, 'provider'], [/^#models-panel$/u, 'models'], [/^#connector-panel$/u, 'connectors'], [/^#templates-panel$/u, 'templates'],
  [/^#webhook-panel$/u, 'webhook'], [/^#memory-panel$/u, 'memory'], [/^#(runs-panel|run-.+)$/u, 'runs'],
];

export const sectionFromHash = (hash: string): SectionId | undefined => hashSections.find(([pattern]) => pattern.test(hash))?.[1];

export function EnvironmentDrawer({ open, section, sections, onSelect, onClose }: { open: boolean; section: SectionId; sections: readonly DrawerSection[]; onSelect: (id: SectionId) => void; onClose: () => void }) {
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const current = sections.find((item) => item.id === section) ?? sections[0];
  useEffect(() => { if (open) heading.current?.focus(); }, [open]);
  useGSAP(() => {
    if (open && motionAllowed()) gsap.fromTo(root.current, { x: 36, opacity: 0 }, { x: 0, opacity: 1, duration: .28, ease: 'power3.out', clearProps: 'transform,opacity' });
  }, { scope: root, dependencies: [open] });
  useGSAP(() => {
    if (open && motionAllowed()) gsap.fromTo('.environment-body', { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: .24, ease: 'power2.out', clearProps: 'transform,opacity' });
  }, { scope: root, dependencies: [open, section] });
  if (!open || current === undefined) return null;
  return <aside id="environment-drawer" className="environment-drawer" ref={root} aria-labelledby="environment-title" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <header><div><small>Workspace</small><h2 id="environment-title" tabIndex={-1} ref={heading}>Environment</h2></div><button type="button" className="button-secondary" onClick={onClose} aria-label="Close environment">Close</button></header>
    <nav aria-label="Environment sections"><ul>{sections.map((item) => <li key={item.id}><button type="button" aria-current={item.id === current.id ? 'page' : undefined} className={item.id === current.id ? 'active' : ''} onClick={() => onSelect(item.id)}>{item.label}</button></li>)}</ul></nav>
    <section className="environment-body" aria-labelledby={`environment-section-${current.id}`}><h3 id={`environment-section-${current.id}`}>{current.label}</h3><p className="field-help">{current.hint}</p>{current.render()}</section>
  </aside>;
}
