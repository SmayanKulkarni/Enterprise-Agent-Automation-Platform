import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { CopyUrl, GithubWebhookSetup, webhookDeliveryUrl } from './webhook-setup.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const definition = '22222222-2222-4222-8222-222222222222';

test('the delivery URL is the public origin, the tenant and the definition', () => {
  expect(webhookDeliveryUrl('https://app.example', tenant, definition)).toBe(`https://app.example/api/workflow-webhook/${tenant}/${definition}`);
  expect(webhookDeliveryUrl('https://app.example/', tenant, definition)).toBe(`https://app.example/api/workflow-webhook/${tenant}/${definition}`);
});

test('the URL is shown read-only with a copy button', () => {
  const html = renderToStaticMarkup(<CopyUrl url="https://app.example/hook" />);
  for (const text of ['value="https://app.example/hook"', 'readOnly', 'Copy URL']) expect(html).toContain(text);
});

test('the GitHub hint names the URL, JSON content type, the secret and the pull request and push events', () => {
  const html = renderToStaticMarkup(<GithubWebhookSetup url="https://app.example/hook" />);
  for (const text of ['https://app.example/hook', 'application/json', 'shown once', 'Pull requests', 'Pushes']) expect(html).toContain(text);
  expect(html).not.toMatch(/secret[^<]*[0-9a-f]{32}/iu);
});
