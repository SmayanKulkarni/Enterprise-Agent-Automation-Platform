import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { AssistantPanel, type PanelProps } from './assistant-drawer.js';

const noop = () => undefined;
const props: PanelProps = {
  messages: [], draft: '', busy: false, notice: undefined, provider: 'azure-openai', model: 'gpt-4o', models: [], modelStatus: 'ready',
  billingTenantId: 'a1', workspaces: [{ id: 'a1', name: 'Alpha' }, { id: 'b2', name: 'Beta' }], scopeName: 'Alpha', range: '7d',
  onDraft: noop, onSend: noop, onProvider: noop, onModel: noop, onBilling: noop, onRetryModels: noop,
};
const render = (overrides: Partial<PanelProps> = {}) => renderToStaticMarkup(<AssistantPanel {...props} {...overrides} />);

describe('AssistantPanel', () => {
  test('renders an answer as escaped text inside a pre-wrap element', () => {
    const html = render({ messages: [{ role: 'assistant', content: '<img src=x onerror=alert(1)>' }] });

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
    expect(html).toContain('white-space:pre-wrap');
  });

  test('labels each message with who wrote it', () => {
    const html = render({ messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }] });

    expect(html).toContain('You');
    expect(html).toContain('Assistant');
  });

  test('states the scope and range the answer will use', () => {
    expect(render()).toContain('Answers use Alpha over the last 7d.');
  });

  test('disables Send with no text', () => {
    expect(render()).toMatch(/<button[^>]*disabled=""[^>]*>Send<\/button>/u);
  });

  test('enables Send with text and disables it while a request is in flight', () => {
    expect(render({ draft: 'Why?' })).not.toMatch(/<button[^>]*disabled=""[^>]*>Send<\/button>/u);
    expect(render({ draft: 'Why?', busy: true })).toMatch(/<button[^>]*disabled=""[^>]*>Send<\/button>/u);
  });

  test('limits the textarea to 2000 characters', () => {
    expect(render()).toContain('maxLength="2000"');
  });

  test('shows a notice', () => {
    expect(render({ notice: { tone: 'danger', text: 'The assistant is not configured for this environment.' } })).toContain('not configured');
  });
});
