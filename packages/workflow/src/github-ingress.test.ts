import { createHmac } from 'node:crypto';
import { expect, test } from 'vitest';
import { validateGraph, type GraphDraft } from './graph.js';
import { ingressResponse } from './ingress-outcome.js';
import { deliverWebhook, type Scheduler } from './service.js';
import { DEFINITION, MemoryRecords, TENANT, asStore, publish, readRun, shape } from './worker-harness.test-support.js';

const SECRET = 'github-secret';
const GUID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const inputSchema = shape({ repo: { type: 'string' }, pr: { type: 'number' }, head: { type: 'string' } });
const trigger = { mode: 'webhook', source: 'github', inputSchema, inputMap: { repo: '$body.repository.full_name', pr: '$body.pull_request.number', head: '$body.pull_request.head.sha' }, when: { event: ['pull_request', 'push'], action: ['opened', 'synchronize'] } };
const payload = (extra: Record<string, unknown> = {}) => ({ action: 'opened', repository: { full_name: 'o/r' }, pull_request: { number: 7, head: { sha: 'abc123' } }, ...extra });

function setup(config: Record<string, unknown> = trigger) {
  const records = new MemoryRecords();
  publish(records, [{ id: 'trigger', kind: 'trigger', config, next: 'end' }, { id: 'end', kind: 'end', config: {}, next: null }], []);
  const started: string[] = [];
  const scheduler: Scheduler = { start: async (runId) => { started.push(runId); }, raise: async () => {} };
  const send = (body: unknown, headers: Record<string, string> = {}, secret = SECRET) => {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : new TextEncoder().encode(JSON.stringify(body));
    const signature = `sha256=${createHmac('sha256', secret).update(bytes).digest('hex')}`;
    return deliverWebhook(asStore(records), scheduler, { tenantId: TENANT, definitionId: DEFINITION, eventId: undefined, timestamp: undefined, signature: undefined, body: bytes, fallbackSecret: SECRET, headers: { 'x-hub-signature-256': signature, 'x-github-delivery': GUID, 'x-github-event': 'pull_request', ...headers } });
  };
  return { records, started, send };
}

test('a signed GitHub delivery starts a run whose input is mapped from the payload', async () => {
  const { records, started, send } = setup();
  const delivered = await send(payload());
  expect(delivered.outcome).toBe('accepted');
  expect((await readRun(records, delivered.runId!)).data.input).toEqual({ repo: 'o/r', pr: 7, head: 'abc123' });
  expect(started).toEqual([delivered.runId]);
});

test('a redelivery with the same delivery id replays to the same run', async () => {
  const { started, send } = setup();
  const first = await send(payload()); const again = await send(payload());
  expect(again).toEqual({ outcome: 'replay', runId: first.runId });
  expect(started).toHaveLength(1);
});

test('a body that was changed after signing is refused', async () => {
  const { records, send } = setup();
  const bytes = JSON.stringify(payload());
  const forged = await deliverWebhook(asStore(records), { start: async () => {}, raise: async () => {} }, { tenantId: TENANT, definitionId: DEFINITION, eventId: undefined, timestamp: undefined, signature: undefined, body: new TextEncoder().encode(bytes.replace('abc123', 'evil99')), fallbackSecret: SECRET, headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', SECRET).update(bytes).digest('hex')}`, 'x-github-delivery': GUID, 'x-github-event': 'pull_request' } });
  expect(forged.outcome).toBe('signature');
  expect((await send(payload(), {}, 'wrong-secret')).outcome).toBe('signature');
});

test.each([
  ['an event type outside the filter', payload(), { 'x-github-event': 'issues' }],
  ['an action outside the filter', payload({ action: 'closed' }), {}],
  ['a deleted push', { ...payload(), deleted: true }, { 'x-github-event': 'push' }],
])('%s is verified then ignored without starting a run', async (_label, body, headers) => {
  const { started, send } = setup();
  const delivered = await send(body, headers);
  expect(delivered).toEqual({ outcome: 'ignored' });
  expect(started).toEqual([]);
});

test('a payload that does not carry the mapped fields is refused as malformed', async () => {
  const { send } = setup();
  expect((await send(payload({ pull_request: { head: { sha: 'x' } } }))).outcome).toBe('invalid-shape');
});

test.each([
  ['a missing delivery id', { 'x-github-delivery': '' }],
  ['a delivery id that is not a uuid', { 'x-github-delivery': 'abc' }],
  ['a missing event header', { 'x-github-event': '' }],
])('%s is refused as malformed', async (_label, headers) => {
  const { send } = setup();
  expect((await send(payload(), headers)).outcome).toBe('invalid-shape');
});

test('a definition that is not a GitHub source refuses a GitHub-signed delivery', async () => {
  const { send } = setup({ mode: 'webhook', inputSchema });
  expect((await send(payload())).outcome).toBe('invalid-shape');
});

test('a body over the size limit is refused before any signature work', async () => {
  const { send } = setup();
  expect((await send('x'.repeat(1024 * 1024 + 1))).outcome).toBe('too-large');
});

test('ingress answers an ignored delivery with 202 and a too-large one with 413', () => {
  expect(ingressResponse({ outcome: 'ignored' })).toMatchObject({ status: 202, body: { status: 'ignored' } });
  expect(ingressResponse({ outcome: 'too-large' })).toMatchObject({ status: 413, contentType: 'application/problem+json' });
});

const draft = (extra: Record<string, unknown>, mode = 'webhook'): GraphDraft => ({ kind: 'graph-v1', nodes: [
  { id: 'start', kind: 'trigger', title: 's', detail: '', x: 0, y: 0, instructions: '', config: { mode, inputSchema, ...extra } },
  { id: 'end', kind: 'end', title: 'e', detail: '', x: 0, y: 0, instructions: '', config: {} },
], edges: [{ id: 'a', from: 'start', to: 'end' }] });
const invalid = (extra: Record<string, unknown>, mode?: string): boolean => validateGraph(draft(extra, mode)).some((issue) => issue.code === 'INVALID_TRIGGER');

test.each([
  [{ source: 'github', inputMap: trigger.inputMap }, false],
  [{ source: 'github', inputMap: trigger.inputMap, when: { event: ['push'] } }, false],
  [{ source: 'github' }, true],
  [{ source: 'github', inputMap: { repo: '$body.a', pr: '$body.b' } }, true],
  [{ source: 'github', inputMap: { ...trigger.inputMap, extra: '$body.x' } }, true],
  [{ source: 'github', inputMap: { ...trigger.inputMap, repo: 'literal' } }, true],
  [{ source: 'github', inputMap: { ...trigger.inputMap, repo: '$event' } }, false],
  [{ source: 'github', inputMap: trigger.inputMap, when: { event: [] } }, true],
  [{ source: 'github', inputMap: trigger.inputMap, when: { nope: ['x'] } }, true],
  [{ source: 'other', inputMap: trigger.inputMap }, true],
  [{ inputMap: trigger.inputMap }, true],
])('trigger config %j is invalid: %s', (extra, expected) => {
  expect(invalid(extra)).toBe(expected);
});

test('a GitHub source needs a webhook trigger', () => {
  expect(invalid({ source: 'github', inputMap: trigger.inputMap }, 'manual')).toBe(true);
});
