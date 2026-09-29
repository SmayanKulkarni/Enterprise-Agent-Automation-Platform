import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { context, describeModel, filterModels, pricing, modelProblem, OTHER_DEPLOYMENT, VISIBLE_LIMIT, type CatalogModel, type CatalogStatus } from './model-catalog.js';

export { parseCatalogModels, type CatalogModel, type CatalogStatus } from './model-catalog.js';

interface ModelPickerProps { label: string; value: string; onChange: (value: string) => void; models: readonly CatalogModel[]; help?: string; requireStructured?: boolean; requireTools?: boolean; error?: string | undefined; status?: CatalogStatus; onRetry?: (() => void) | undefined; providerLabel?: string; allowOther?: boolean; strictCatalog?: boolean; }

export function ModelPicker({ label, value, onChange, models, help, requireStructured = false, requireTools = false, error, status = 'ready', onRetry, providerLabel = 'OpenRouter', allowOther = false, strictCatalog = true }: ModelPickerProps) {
  const id = useId(); const listId = `${id}-list`; const helpId = `${id}-help`; const errorId = `${id}-error`;
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string>();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [custom, setCustom] = useState(false);
  const selected = models.find((item) => item.id === value);
  const visible = useMemo(() => filterModels(models, draft), [models, draft]);
  const shown = visible.slice(0, VISIBLE_LIMIT);
  const rows = allowOther ? [...shown, { id: OTHER_DEPLOYMENT, structuredOutput: true, tools: true } satisfies CatalogModel] : shown;
  const problem = error ?? modelProblem(selected, value, strictCatalog ? models.length : 0, requireStructured, requireTools, providerLabel);
  useEffect(() => { setActive(draft === undefined || draft.trim() === '' ? -1 : 0); }, [draft]);
  const close = () => { setOpen(false); setDraft(undefined); };
  const commit = (next: string) => { const trimmed = next.trim(); if (trimmed !== value) onChange(trimmed); close(); };
  const choose = (row: CatalogModel | undefined) => {
    if (row === undefined) { commit(draft ?? value); return; }
    if (row.id === OTHER_DEPLOYMENT) { setCustom(true); setDraft(''); setOpen(false); input.current?.focus(); return; }
    setCustom(false); commit(row.id);
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      const size = rows.length; const down = event.key === 'ArrowDown';
      setActive((current) => size === 0 ? -1 : down ? (current + 1) % size : current < 0 ? size - 1 : (current - 1 + size) % size);
      return;
    }
    if (event.key === 'Home' && open) { event.preventDefault(); setActive(rows.length === 0 ? -1 : 0); return; }
    if (event.key === 'End' && open) { event.preventDefault(); setActive(rows.length - 1); return; }
    if (event.key === 'Enter') { event.preventDefault(); if (!open) { setOpen(true); return; } const row = rows[active]; if (row) choose(row); else commit(draft ?? value); return; }
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
  };
  const describedBy = [help ?? describeModel(selected) ? helpId : undefined, problem ? errorId : undefined].filter(Boolean).join(' ') || undefined;
  return <div className="field model-picker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { if (custom && draft?.trim()) commit(draft); else close(); } }}>
    <label htmlFor={id}>{label}</label>
    <input ref={input} id={id} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-haspopup="listbox" aria-activedescendant={open && rows[active] ? `${id}-option-${active}` : undefined} aria-describedby={describedBy} aria-invalid={problem ? true : undefined} value={draft ?? value} placeholder={custom ? 'Type the deployment name' : undefined} autoComplete="off" spellCheck={false}
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={(event) => { setDraft(event.target.value); setOpen(true); }} onKeyDown={keyDown} />
    {open && <ul id={listId} role="listbox" aria-label={`${label} options`} className="model-options">
      {status === 'failed' && <li role="presentation" className="model-status" aria-live="polite">{providerLabel} models couldn't be loaded. Type an exact model name, or <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onRetry}>retry</button>.</li>}
      {status === 'loading' && <li role="presentation" className="model-status" aria-live="polite">Loading {providerLabel} models…</li>}
      {status === 'ready' && rows.length === 0 && <li role="presentation" className="model-status" aria-live="polite">No model matches “{draft}”. Press Enter to use it as typed.</li>}
      {rows.map((row, index) => row.id === OTHER_DEPLOYMENT
        ? <li key={row.id} id={`${id}-option-${index}`} role="option" aria-selected={index === active} className={index === active ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(row)}><strong>Other deployment name…</strong><small>Type the name of your own deployment.</small></li>
        : <li key={row.id} id={`${id}-option-${index}`} role="option" aria-selected={row.id === value} className={`${index === active ? 'active' : ''} ${(requireStructured && !row.structuredOutput) || (requireTools && row.tools === false) ? 'unsupported' : ''}`} onMouseDown={(event) => event.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => choose(row)}>
          <strong>{row.name ?? row.id}</strong><code>{row.id}</code>
          <small>{[context(row), pricing(row), row.tools === true ? 'tools' : row.tools === false ? 'no tools' : undefined, row.structuredOutput ? undefined : 'no structured output'].filter(Boolean).join(' · ')}</small>
        </li>)}
      {visible.length > VISIBLE_LIMIT && <li role="presentation" className="model-status">{visible.length - VISIBLE_LIMIT} more. Keep typing to narrow the list.</li>}
    </ul>}
    {(help ?? describeModel(selected)) && <small id={helpId} className="field-help">{describeModel(selected) ?? help}</small>}
    {problem && <small id={errorId} className="field-error" role="alert">{problem}</small>}
  </div>;
}
