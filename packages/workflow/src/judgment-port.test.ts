import { randomBytes } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { observe, resetObservers } from '../../telemetry/src/observe.test-support.js';
import { OpenRouterConnectionCrypto } from './openrouter-connection.js';
import { HttpModelPort } from './ports.js';
import type { JudgmentRequest } from './runtime.js';
import type { WorkflowStore } from './sql.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const crypto = new OpenRouterConnectionCrypto('v1', randomBytes(32));
const store = { workerRead: (_tenant: string, kind: string) => Promise.resolve({ id: 'c', kind, version: 1, state: 'ready', data: { provider: 'openrouter', enabled: true, key: crypto.seal(tenant, 'tenant-key') } }) } as unknown as WorkflowStore;
const port = (environment: Record<string, string> = { WORKFLOW_OPENROUTER_MAX_COST_PER_1K_TOKENS: '0.5' }) => new HttpModelPort(environment, store, crypto);

const request = (patch: Partial<JudgmentRequest> = {}): JudgmentRequest => ({
  tenantId: tenant, model: 'typesafe/jev-1.13', milliseconds: 5000, telemetry: { feature: 'judgment', runId: 'run-1', nodeId: 'triage', attempt: 1 },
  state: { ticket: 'refund me please' },
  questions: {
    team: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'Charges', none: 'Other' }, thresholds: { act: 0.9, review: 0.7 }, gate: false } as never,
    refund: { type: 'noul', instructions: 'Wants money back?' },
    urgency: { type: 'score', instructions: 'How urgent?', criteria: ['Low', 'High'] },
  },
  ...patch,
});
const answers = { team: { type: 'choice', choice: 'billing', confidence: 0.9, probabilities: { billing: 0.9, none: 0.1 } }, refund: { type: 'noul', noul: 0.9 }, urgency: { type: 'score', score: 0.2, confidence: 0.7, probabilities: { '0': 0.8, '1': 0.2 } } };
const reply = (patch: Record<string, unknown> = {}) => Response.json({ id: 'gen-dec-1', model: 'typesafe/jev-1.13-20260917', provider: 'TypeSafe', answers, usage: { input_tokens: 400, output_tokens: 20, cost: 0.000019 }, ...patch });

afterEach(() => { vi.unstubAllGlobals(); resetObservers(); });

test('every question goes in one request without thresholds or gate and without leaking the key', async () => {
  const fetcher = vi.fn().mockResolvedValue(reply()); vi.stubGlobal('fetch', fetcher);
  const result = await port().judge(request());
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
  expect(init.method).toBe('POST');
  expect(init.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer tenant-key' });
  expect(JSON.parse(init.body as string)).toEqual({
    model: 'typesafe/jev-1.13', state: { ticket: 'refund me please' },
    questions: { team: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'Charges', none: 'Other' } }, refund: { type: 'noul', instructions: 'Wants money back?' }, urgency: { type: 'score', instructions: 'How urgent?', criteria: ['Low', 'High'] } },
  });
  expect(init.body as string).not.toContain('tenant-key');
  expect(result).toEqual({ answers, model: 'typesafe/jev-1.13', requestId: 'gen-dec-1', tokens: 420, cost: 0.000019, promptTokens: 400, completionTokens: 20 });
});

test('cost falls back to the environment rate when usage.cost is absent', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ usage: { input_tokens: 800, output_tokens: 200 } })));
  expect(await port().judge(request())).toMatchObject({ tokens: 1000, cost: 0.5 });
});

test('a negative cost is ignored in favour of the environment rate', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ usage: { input_tokens: 1000, output_tokens: 0, cost: -1 } })));
  expect(await port().judge(request())).toMatchObject({ cost: 0.5 });
});

test('missing usage counts as unbounded tokens', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ usage: { cost: 0.1 } })));
  expect(await port().judge(request())).toMatchObject({ tokens: Infinity, cost: 0.1 });
});

test('a missing rate with no reported cost is an error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ usage: { input_tokens: 1, output_tokens: 1 } })));
  await expect(port({}).judge(request())).rejects.toThrow('WORKFLOW_OPENROUTER_MAX_COST_PER_1K_TOKENS');
});

test.each([[401, { error: { code: 401, message: 'bad key tenant-key' } }], [422, { error: { message: 'invalid' } }], [529, {}]])('HTTP %i gives PROVIDER_FAILED with the upstream status and no key', async (status, body) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body, { status })));
  const failure = await port().judge(request()).then(() => new Error('resolved'), (error: unknown) => error as Error);
  expect(failure.message).toBe('PROVIDER_FAILED');
  expect(failure.cause).toEqual({ upstreamStatus: status });
  expect(JSON.stringify(failure)).not.toContain('tenant-key');
});

test('an error body on HTTP 200 gives PROVIDER_FAILED and a non-JSON body gives INVALID_PROVIDER_RESPONSE', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 429, message: 'slow down' } })));
  await expect(port().judge(request())).rejects.toThrow('PROVIDER_FAILED');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([1])));
  await expect(port().judge(request())).rejects.toThrow('INVALID_PROVIDER_RESPONSE');
});

test.each([
  ['missing answers', { answers: undefined }],
  ['a missing question', { answers: { team: answers.team, refund: answers.refund } }],
  ['an extra question', { answers: { ...answers, extra: { type: 'noul', noul: 0.5 } } }],
  ['a non-object answer', { answers: { ...answers, refund: 'yes' } }],
])('%s gives INVALID_MODEL_OUTPUT', async (_name, patch) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(patch)));
  await expect(port().judge(request())).rejects.toThrow('INVALID_MODEL_OUTPUT');
});

test('an alias or malformed model is denied before any call', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(port().judge(request({ model: 'not a slug' }))).rejects.toThrow('DENIED');
  expect(fetcher).not.toHaveBeenCalled();
});

test('a successful call records a judgment span, duration, token and cost metrics and one judgment.call event without content', async () => {
  const { spans, points, events, everything } = observe();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply()));
  await port().judge(request());
  const labels = { 'gen_ai.provider.name': 'openrouter', 'gen_ai.request.model': 'typesafe/jev-1.13', tenant_id: tenant, feature: 'judgment' };
  expect((await spans()).map((span) => ({ name: span.name, attributes: span.attributes, status: span.status.code }))).toEqual([{ name: 'decide typesafe/jev-1.13', attributes: { 'gen_ai.operation.name': 'decision', 'gen_ai.provider.name': 'openrouter', 'gen_ai.request.model': 'typesafe/jev-1.13', tenant_id: tenant, feature: 'judgment', 'workflow.run_id': 'run-1', 'workflow.node_id': 'triage', 'gen_ai.response.model': 'typesafe/jev-1.13-20260917' }, status: 0 }]);
  expect((await points('gen_ai.client.operation.duration')).map((point) => point.attributes)).toEqual([labels]);
  expect((await points('gen_ai.client.token.usage')).map((point) => ({ type: point.attributes['gen_ai.token.type'], sum: (point.value as { sum: number }).sum })).sort((left, right) => String(left.type).localeCompare(String(right.type)))).toEqual([{ type: 'input', sum: 400 }, { type: 'output', sum: 20 }]);
  expect((await points('gen_ai.client.cost')).map((point) => ({ value: point.value, attributes: point.attributes }))).toEqual([{ value: 0.000019, attributes: labels }]);
  expect(events('judgment.call')).toEqual([{ event: 'judgment.call', level: 'info', at: expect.any(String) as string, tenant_id: tenant, run_id: 'run-1', node_id: 'triage', model: 'typesafe/jev-1.13', question_count: 3, attempt: 1, outcome: 'succeeded', tokens: 420, cost: 0.000019, duration_s: expect.any(Number) as number }]);
  const everythingText = await everything();
  expect(everythingText).not.toContain('refund me please');
  expect(everythingText).not.toContain('Wants money back');
  expect(everythingText).not.toContain('billing');
});

test('a failed call marks the span, records the error type and logs a failed outcome', async () => {
  const { spans, points, events } = observe();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({}, { status: 422 })));
  await expect(port().judge(request())).rejects.toThrow('PROVIDER_FAILED');
  expect((await spans())[0]?.status.code).toBe(2);
  expect((await points('gen_ai.client.operation.duration'))[0]?.attributes['error.type']).toBe('PROVIDER_FAILED');
  expect(events('judgment.call')[0]).toMatchObject({ outcome: 'failed', question_count: 3 });
});
