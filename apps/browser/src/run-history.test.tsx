import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { RunHistory } from './run-history.js';

const run = (extra: Record<string, unknown>) => ({ id: 'run-1', version: 5, status: 'rejected', definitionRevision: 2, definitionDigest: 'd'.repeat(64), inputDigest: 'i'.repeat(64), inputSummary: [], history: [], effects: [], ...extra });
const render = (records: Record<string, unknown>[]) => renderToStaticMarkup(<RunHistory records={records} admin decide={() => {}} reconcile={() => {}} loadOlder={() => {}} hasMore={false} loadingOlder={false} />);

test('a decided run still shows what the approver saw, who decided and why', () => {
  const html = render([run({ decisions: { gate: { outcome: 'reject', reason: 'wrong branch <b>x</b>', approverId: 'user-9', decidedAt: '2026-01-01T00:00:00.000Z', bindingDigest: 'b'.repeat(64), facts: [{ name: 'title', value: 'Return PR #2' }] } } })]);
  for (const text of ['Decision record', 'reject', 'user-9', 'title', 'Return PR #2', 'wrong branch &lt;b&gt;x&lt;/b&gt;']) expect(html).toContain(text);
});

test.each([
  ['rejected', 'The administrator rejected'],
  ['expired', 'The approval deadline expired'],
  ['cancelled', 'cancelled before it finished'],
  ['superseded', 'replaced by a newer event'],
])('a %s run is described as a deliberate outcome, not a failure', (status, text) => {
  const html = render([run({ status })]);
  expect(html).toContain(text);
  expect(html).not.toContain('stopped before completing');
});
