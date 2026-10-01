import { useEffect, useState, type FormEvent } from 'react';
import { Field, Notice } from '../ui.js';
import type { SeriesStatus, Trace } from './decoders.js';
import { formatDuration, isUuid, waterfall } from './governance-model.js';
import type { GovernanceSource } from './governance-source.js';

const MAX_DEPTH = 4;
const statusText: Record<Exclude<SeriesStatus, 'ready'>, string> = { 'not-configured': 'Tracing is not configured for this environment.', unavailable: 'Tracing is unavailable right now. Try again shortly.' };
const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

export function TraceView({ trace }: { trace: Trace }) {
  const [selected, setSelected] = useState<string>();
  if (trace.status !== 'ready') return <p className="card-empty">{statusText[trace.status]}</p>;
  if (trace.spans.length === 0) return <p className="card-empty">This run has no spans.</p>;
  const { totalMs, rows } = waterfall(trace.spans);
  const origin = rows[0]?.span.startMs ?? 0;
  const keyOf = (row: (typeof rows)[number]): string => `${row.span.traceId}:${row.span.spanId}`;
  const chosen = rows.find((row) => keyOf(row) === selected);
  return (
    <div className="trace-view">
      <div className="trace-summary">
        <span><small>Spans</small><strong>{trace.spans.length}</strong></span>
        <span><small>Duration</small><strong>{formatDuration(totalMs)}</strong></span>
        <span><small>Errors</small><strong>{trace.spans.filter((span) => span.status === 'error').length}</strong></span>
      </div>
      <ol className="trace-waterfall">
        {rows.map((row) => (
          <li key={keyOf(row)} data-depth={Math.min(row.depth, MAX_DEPTH)}>
            <button aria-pressed={keyOf(row) === selected} aria-label={`${row.span.name}, ${formatDuration(row.span.durationMs)}, starts at +${formatDuration(row.span.startMs - origin)}, ${row.span.status}`} onClick={() => { setSelected(keyOf(row)); }}>
              <i style={{ left: `${String(row.offsetPercent)}%`, width: `${String(row.widthPercent)}%` }} />
              <span>{row.span.name}</span>
              {row.span.status === 'error' && <b className="trace-error">Error</b>}
              <small>{formatDuration(row.span.durationMs)}</small>
            </button>
          </li>
        ))}
      </ol>
      {chosen !== undefined && (
        <dl className="trace-attributes" aria-label={`Attributes of ${chosen.span.name}`}>
          {Object.entries(chosen.span.attributes).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}
          {Object.keys(chosen.span.attributes).length === 0 && <div><dt>Attributes</dt><dd>none</dd></div>}
        </dl>
      )}
    </div>
  );
}

export function TracePanel({ source, runId }: { source: GovernanceSource; runId: string }) {
  const [draft, setDraft] = useState(runId);
  const [applied, setApplied] = useState(runId === '' ? undefined : runId);
  const [inputError, setInputError] = useState<string>();
  const [trace, setTrace] = useState<Trace>();
  const [loading, setLoading] = useState(applied !== undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (applied === undefined) return;
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    source.trace(applied, controller.signal)
      .then((next) => { setTrace(next); setLoading(false); })
      .catch((error: unknown) => { if (isAbort(error) || controller.signal.aborted) return; setFailed(true); setLoading(false); });
    return () => { controller.abort(); };
  }, [source, applied]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const run = draft.trim().toLowerCase();
    if (!isUuid(run)) { setInputError('Enter a run id in UUID form.'); return; }
    setInputError(undefined);
    setApplied(run);
  };

  return (
    <section className="trace-panel" aria-label="Trace" aria-busy={loading}>
      <form className="log-filters" onSubmit={submit}>
        <Field label="Run id" error={inputError}><input value={draft} spellCheck={false} onChange={(event) => { setDraft(event.target.value); }} /></Field>
        <button className="button" type="submit" disabled={loading}>Load trace</button>
      </form>
      {failed && <Notice tone="danger">The trace could not be loaded.</Notice>}
      {trace !== undefined && applied !== undefined && <TraceView trace={trace} />}
    </section>
  );
}
