import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { ApprovalsInbox } from './approvals-inbox.js';
import type { Approval } from './decoders.js';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const row = (overrides: Partial<Approval> = {}): Approval => ({
  tenantId: 't1', workspace: 'Support', runId: 'run-1', runVersion: 4, workflowName: 'Refund flow', revision: 2, nodeId: 'approval', kind: 'tool', capability: 'send-invoice', installationId: 'inst-1', target: 'billing',
  arguments: [{ name: 'subject', type: 'string' }, { name: 'amount', type: 'number' }], facts: [], argumentsDigest: 'a'.repeat(64), requestedAt: new Date(NOW - 60_000).toISOString(), expiresAt: new Date(NOW + 30 * 60_000).toISOString(), bindingDigest: 'b'.repeat(64), ...overrides,
});
const render = (approvals: readonly Approval[], extra: Partial<Parameters<typeof ApprovalsInbox>[0]> = {}) => renderToStaticMarkup(<ApprovalsInbox approvals={approvals} completeness="full" decide={() => undefined} busyRunId={undefined} notice={undefined} canDecide now={NOW} {...extra} />);

describe('ApprovalsInbox', () => {
  test('shows workspace, capability, target and argument names with types', () => {
    const html = render([row()]);
    for (const text of ['Support', 'send-invoice', 'billing', 'subject: string, amount: number', '30 min left']) expect(html).toContain(text);
  });

  test('titles the card with the run label and keeps the workflow name as context', () => {
    const html = render([row({ runLabel: 'octo/demo#7 Fix parser' })]);
    expect(html).toContain('<h3>octo/demo#7 Fix parser</h3>');
    expect(html).toContain('Refund flow');
    expect(render([row()])).toContain('<h3>Refund flow</h3>');
  });

  test('shows disclosed facts as escaped text and nothing else about values', () => {
    const html = render([row({ facts: [{ name: 'title', value: 'Return PR #2 <img src=x onerror=alert(1)>' }] })]);
    expect(html).toContain('Details to review');
    expect(html).toContain('Return PR #2 &lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
  });

  test('shows a Judgment fact with one line per question beside the disclosed facts', () => {
    const value = 'intent: refund · probability 0.91 · confidence 0.88 · band act\nurgency: 1 · probability 0.62 · confidence 0.55 · band escalate · not gating\noverall act · typesafe/jev-1.13';
    const html = render([row({ facts: [{ name: 'orderId', value: 'A-1' }, { name: 'judgment:triage', value }] })]);
    expect(html).toContain('<h4>orderId</h4><pre>A-1</pre>');
    expect(html).toContain('<h4>judgment:triage</h4>');
    expect(html).toContain('urgency: 1 · probability 0.62 · confidence 0.55 · band escalate · not gating\noverall act · typesafe/jev-1.13');
  });

  test('shows no details section without facts', () => {
    expect(render([row()])).not.toContain('Details to review');
  });

  test('has no element for argument values and shortens the digest', () => {
    const html = render([row()]);
    expect(html).not.toContain('b'.repeat(64));
    expect(html).not.toContain('a'.repeat(64));
    expect(html).toContain('aaaaaaaaaaaa…');
  });

  test('disables only the busy card buttons', () => {
    const html = render([row(), row({ runId: 'run-2' })], { busyRunId: 'run-1' });
    const cards = html.split('<article class="approval-card"').slice(1);
    expect(cards[0]).toContain('disabled=""');
    expect(cards[1]).not.toContain('disabled=""');
  });

  test('an expired row says Expired and disables its buttons', () => {
    const html = render([row({ expiresAt: new Date(NOW - 1000).toISOString() })]);
    expect(html).toContain('Expired');
    expect(html.match(/disabled=""/gu)).toHaveLength(2);
  });

  test('an empty inbox says so', () => {
    expect(render([])).toContain('No approvals are waiting.');
  });

  test('a partial inbox says more are waiting', () => {
    expect(render([row()], { completeness: 'partial' })).toContain('More approvals are waiting than are shown here.');
  });

  test('without a session the buttons are disabled with a hint', () => {
    const html = render([row()], { canDecide: false });
    expect(html).toContain('Sign in to decide');
    expect(html.match(/disabled=""/gu)).toHaveLength(2);
  });

  test('renders user-controlled text as text', () => {
    expect(render([row({ target: '<script>x</script>' })])).toContain('&lt;script&gt;');
  });
});
