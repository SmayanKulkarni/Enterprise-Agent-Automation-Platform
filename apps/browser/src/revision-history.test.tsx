import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { loadedNotice, parseRevisions } from './revision-history.js';
import { RevisionHistory } from './revision-history-panel.js';

const graph = (extra: Record<string, unknown> = {}) => ({ kind: 'graph-v1', nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges: [{ id: 'e1', from: 'a', to: 'b' }, { id: 'e2', from: 'b', to: 'c', role: 'tool' }], ...extra });
const record = (revision: unknown, extra: Record<string, unknown> = {}) => ({ id: 'draft', revision, digest: 'a'.repeat(64), state: 'draft', createdAt: '2026-09-29T10:00:00.000Z', graph: graph(), ...extra });

describe('revision history', () => {
  test('orders revisions newest first and counts steps, flow connections and tool edges', () => {
    const entries = parseRevisions([record(1), record(3), record(2)]);
    expect(entries.map((entry) => entry.revision)).toEqual([3, 2, 1]);
    expect(entries[0]).toMatchObject({ steps: 3, connections: 1, tools: 1, state: 'draft' });
  });

  test('drops malformed, foreign-kind and duplicate records instead of loading them onto the canvas', () => {
    const entries = parseRevisions([record(1), record(1), record(0), record(1.5), record('2'), record(4, { graph: graph({ kind: 'package' }) }), record(5, { graph: graph({ nodes: 'x' }) }), record(6, { graph: null }), record(7, { digest: 7 }), record(8, { state: undefined })]);
    expect(entries.map((entry) => entry.revision)).toEqual([1]);
    expect(parseRevisions([])).toEqual([]);
  });

  test('keeps the graph exactly as stored so a load reproduces that revision', () => {
    const [entry] = parseRevisions([record(2)]);
    expect(entry?.graph).toEqual(graph());
  });

  test('says loading an earlier revision leaves history untouched and the next save creates head + 1', () => {
    const [entry] = parseRevisions([record(2)]);
    expect(loadedNotice(entry!, 5)).toMatch(/creates revision 6.*revision 2 is not changed/);
    expect(loadedNotice(entry!, 2)).toBe('Revision 2 loaded on the canvas.');
  });

  test('renders the list, marks the latest revision and offers a load action per revision', () => {
    const entries = parseRevisions([record(1), record(2)]);
    const html = renderToStaticMarkup(<RevisionHistory entries={entries} state="ready" head={2} canSave onLoad={() => undefined} onRetry={() => undefined} onSave={() => undefined} />);
    expect(html).toContain('Load revision 2'); expect(html).toContain('Load revision 1'); expect(html).toContain('Latest');
    expect(html.indexOf('Revision 2')).toBeLessThan(html.indexOf('Revision 1'));
    expect(html).toContain('aria-label="Saved revisions"');
  });

  test('shows loading, failure with retry, and the empty draft state without a stale list', () => {
    const props = { entries: [], head: 3, canSave: true, onLoad: () => undefined, onRetry: () => undefined, onSave: () => undefined };
    expect(renderToStaticMarkup(<RevisionHistory {...props} state="loading" />)).toContain('Loading revisions');
    const failed = renderToStaticMarkup(<RevisionHistory {...props} state="failed" />);
    expect(failed).toContain('Retry'); expect(failed).not.toContain('revision-list');
    expect(renderToStaticMarkup(<RevisionHistory {...props} head={0} state="loading" />)).toContain('Save the canvas to create revision 1');
    expect(renderToStaticMarkup(<RevisionHistory {...props} state="ready" />)).toContain('no readable revisions');
  });
});
