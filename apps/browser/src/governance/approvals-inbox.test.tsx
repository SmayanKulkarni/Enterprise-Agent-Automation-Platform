import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { ApprovalsInbox } from './approvals-inbox.js';
import type { Approval } from './decoders.js';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const row = (overrides: Partial<Approval> = {}): Approval => ({
  tenantId: 't1', workspace: 'Support', runId: 'run-1', runVersion: 4, workflowName: 'Refund flow', revision: 2, nodeId: 'approval', kind: 'tool', capability: 'send-invoice', installationId: 'inst-1', target: 'billing',
  arguments: [{ name: 'subject', type: 'string' }, { name: 'amount', type: 'number' }], argumentsDigest: 'a'.repeat(64), requestedAt: new Date(NOW - 60_000).toISOString(), expiresAt: new Date(NOW + 30 * 60_000).toISOString(), bindingDigest: 'b'.repeat(64), ...overrides,
});
const render = (approvals: readonly Approval[], extra: Partial<Parameters<typeof ApprovalsInbox>[0]> = {}) => renderToStaticMarkup(<ApprovalsInbox approvals={approvals} completeness="full" decide={() => undefined} busyRunId={undefined} notice={undefined} canDecide now={NOW} {...extra} />);

describe('ApprovalsInbox', () => {
  test('shows workspace, capability, target and argument names with types', () => {
    const html = render([row()]);
    for (const text of ['Support', 'send-invoice', 'billing', 'subject: string, amount: number', '30 min left']) expect(html).toContain(text);
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
