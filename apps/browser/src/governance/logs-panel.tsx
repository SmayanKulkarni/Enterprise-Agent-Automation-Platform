import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { EVENTS } from '../../../../packages/telemetry/src/event-names.js';
import { formatMoment } from '../charts/scale.js';
import { Field, Notice } from '../ui.js';
import type { LogEntry, RangeKey, SeriesStatus } from './decoders.js';
import { DASH, isUuid, logsQuery, shortId } from './governance-model.js';
import type { GovernanceSource } from './governance-source.js';

const LEVELS = ['info', 'warn', 'error'] as const;
const EVENT_NAMES = Object.keys(EVENTS);
const statusText: Record<Exclude<SeriesStatus, 'ready'>, string> = { 'not-configured': 'Logs are not configured for this environment.', unavailable: 'Logs are unavailable right now. Try again shortly.' };
const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

interface ListProps { entries: readonly LogEntry[]; status: SeriesStatus; names: Readonly<Record<string, string>>; openTrace: (runId: string) => void }

export function LogList({ entries, status, names, openTrace }: ListProps) {
  const base = useId();
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const toggle = (index: number) => { setOpen((current) => { const next = new Set(current); if (!next.delete(index)) next.add(index); return next; }); };
  if (status !== 'ready') return <p className="card-empty">{statusText[status]}</p>;
  if (entries.length === 0) return <p className="card-empty">No log entries match these filters.</p>;
  return (
    <ol className="log-list">
      {entries.map((entry, index) => {
        const id = `${base}-${String(index)}`;
        const tenant = entry.attributes['tenant_id'];
        const runId = entry.attributes['run_id'];
        return (
          <li key={`${entry.at}-${String(index)}`} className="log-row">
            <button className="log-summary" aria-expanded={open.has(index)} aria-controls={id} onClick={() => { toggle(index); }}>
              <time dateTime={entry.at}>{formatMoment(Date.parse(entry.at))}</time>
              <span>{entry.level}</span>
              <span>{entry.event}</span>
              <span>{typeof tenant === 'string' ? names[tenant] ?? shortId(tenant) : DASH}</span>
            </button>
            {typeof runId === 'string' && <button className="button-secondary button-small" onClick={() => { openTrace(runId); }}>View trace</button>}
            <dl id={id} hidden={!open.has(index)}>
              {Object.entries(entry.attributes).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}
            </dl>
          </li>
        );
      })}
    </ol>
  );
}

interface Props { source: GovernanceSource; scope: string | undefined; range: RangeKey; names: Readonly<Record<string, string>>; openTrace: (runId: string) => void }
const NO_FILTERS = { level: '', event: '', run: '' };
const RUN_ERROR = 'Enter a run id in UUID form.';

export function LogsPanel({ source, scope, range, names, openTrace }: Props) {
  const [draft, setDraft] = useState(NO_FILTERS);
  const [applied, setApplied] = useState(NO_FILTERS);
  const [runError, setRunError] = useState<string>();
  const [entries, setEntries] = useState<readonly LogEntry[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [status, setStatus] = useState<SeriesStatus>('ready');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);

  const fetchPage = (after: string | undefined): void => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setLoading(true);
    setFailed(false);
    source.logs(logsQuery({ range, scope, ...applied, cursor: after }), next.signal)
      .then((page) => {
        setStatus(page.status);
        setEntries((current) => after === undefined ? page.entries : [...current, ...page.entries]);
        setCursor(page.continuation?.cursor);
        setLoading(false);
      })
      .catch((error: unknown) => { if (isAbort(error) || next.signal.aborted) return; setFailed(true); setLoading(false); });
  };

  useEffect(() => {
    setEntries([]);
    setCursor(undefined);
    fetchPage(undefined);
    return () => { controller.current?.abort(); };
  }, [source, scope, range, applied]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const run = draft.run.trim();
    if (run !== '' && !isUuid(run)) { setRunError(RUN_ERROR); return; }
    setRunError(undefined);
    setApplied({ ...draft, run });
  };

  return (
    <section className="logs-panel" aria-label="Logs" aria-busy={loading}>
      <form className="log-filters" onSubmit={submit}>
        <Field label="Level"><select value={draft.level} onChange={(event) => { setDraft({ ...draft, level: event.target.value }); }}><option value="">Any</option>{LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}</select></Field>
        <Field label="Event"><select value={draft.event} onChange={(event) => { setDraft({ ...draft, event: event.target.value }); }}><option value="">Any</option>{EVENT_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}</select></Field>
        <Field label="Run id" error={runError}><input value={draft.run} spellCheck={false} onChange={(event) => { setDraft({ ...draft, run: event.target.value }); }} /></Field>
        <button className="button" type="submit" disabled={loading}>Apply filters</button>
      </form>
      {failed && <Notice tone="danger">Logs could not be loaded.</Notice>}
      <LogList entries={entries} status={status} names={names} openTrace={openTrace} />
      {cursor !== undefined && <button className="button-secondary" disabled={loading} onClick={() => { fetchPage(cursor); }}>Load older</button>}
    </section>
  );
}
