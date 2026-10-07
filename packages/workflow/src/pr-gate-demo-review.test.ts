import { expect, test } from 'vitest';
import { PR_GATE_DEFAULT_MODEL } from './pr-gate-template.js';
import { demoReviewer } from './pr-gate-demo-review.js';

const VERDICT = { accept: true, riskLevel: 'low', summary: 'Fine.', findings: [] };
const reply = (content: unknown, usage: unknown = { total_tokens: 90, prompt_tokens: 80, completion_tokens: 10, cost: 0.0001 }) => Response.json({ choices: [{ message: { content: JSON.stringify(content) } }], usage });

test('without a key there is no reviewer', () => {
  expect(demoReviewer({}, () => Promise.reject(new Error('unused')))).toBeUndefined();
  expect(demoReviewer({ DEMO_OPENROUTER_API_KEY: '  ' }, () => Promise.reject(new Error('unused')))).toBeUndefined();
});

test('one capped, schema-bound request carries the key and the clipped diff as data', async () => {
  const seen: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const review = demoReviewer({ DEMO_OPENROUTER_API_KEY: 'sk-or-test' }, (url, init) => { seen.push({ url, headers: new Headers(init?.headers), body: JSON.parse(init?.body as string) as Record<string, unknown> }); return Promise.resolve(reply(VERDICT)); });
  expect(await review?.('d'.repeat(100_000))).toEqual(VERDICT);
  expect(seen).toHaveLength(1);
  expect(seen[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
  expect(seen[0]?.headers.get('authorization')).toBe('Bearer sk-or-test');
  expect(seen[0]?.body).toMatchObject({ model: PR_GATE_DEFAULT_MODEL, max_completion_tokens: 700, response_format: { type: 'json_schema', json_schema: { strict: true } } });
  const messages = seen[0]?.body['messages'] as { role: string; content: string }[];
  expect(messages.map((message) => message.role)).toEqual(['system', 'user']);
  expect(messages[0]?.content).not.toContain('ddd');
  expect((JSON.parse(messages[1]?.content ?? '{}') as { diff: string }).diff).toHaveLength(40_000);
});

test.each([
  ['a provider error', () => Promise.resolve(new Response('no', { status: 500 }))],
  ['a non-JSON answer', () => Promise.resolve(Response.json({ choices: [{ message: { content: 'not json' } }] }))],
  ['a missing answer', () => Promise.resolve(Response.json({ choices: [] }))],
])('%s rejects so the caller can fall back', async (_name, send) => {
  const review = demoReviewer({ DEMO_OPENROUTER_API_KEY: 'sk-or-test' }, send);
  await expect(review?.('diff')).rejects.toThrow();
});
