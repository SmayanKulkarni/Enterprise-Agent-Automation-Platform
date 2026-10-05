import { expect, test } from 'vitest';
import { validateGraph, type GraphDraft } from './graph.js';
import { LABEL_LIMIT, labelOf } from './label.js';
import { deliverWebhook } from './service.js';
import { createHmac } from 'node:crypto';
import { DEFINITION, MemoryRecords, TENANT, asStore, publish, readRun, shape } from './worker-harness.test-support.js';

const input = { repo: 'o/r', pr: 7, title: 'Fix\nbug' };

test('tokens are replaced by input values and control characters become spaces', () => {
  expect(labelOf({ label: '$input.repo#$input.pr $input.title' }, input)).toBe('o/r#7 Fix bug');
});

test('a label is capped and a missing template or empty result gives no label', () => {
  expect(labelOf({ label: '$input.title'.repeat(50) }, { title: 'x'.repeat(300) })?.length).toBe(LABEL_LIMIT);
  expect(labelOf({}, input)).toBeUndefined();
  expect(labelOf({ label: '$input.absent' }, input)).toBeUndefined();
});

const draft = (label: unknown): GraphDraft => ({ kind: 'graph-v1', nodes: [
  { id: 'start', kind: 'trigger', title: 's', detail: '', x: 0, y: 0, instructions: '', config: { mode: 'manual', inputSchema: shape({ repo: { type: 'string' } }), ...(label === undefined ? {} : { label }) } },
  { id: 'end', kind: 'end', title: 'e', detail: '', x: 0, y: 0, instructions: '', config: {} },
], edges: [{ id: 'a', from: 'start', to: 'end' }] });

test.each([[undefined, true], ['$input.repo run', true], ['$input.missing', false], ['', false], [5, false], ['x'.repeat(201), false]])('label template %j is valid: %s', (label, valid) => {
  expect(validateGraph(draft(label)).some((issue) => issue.code === 'INVALID_TRIGGER')).toBe(!valid);
});

test('a webhook run stores the resolved label', async () => {
  const records = new MemoryRecords();
  publish(records, [{ id: 'trigger', kind: 'trigger', config: { mode: 'webhook', inputSchema: shape({ repo: { type: 'string' }, pr: { type: 'number' } }), label: '$input.repo#$input.pr' }, next: 'end' }, { id: 'end', kind: 'end', config: {}, next: null }], []);
  const body = new TextEncoder().encode(JSON.stringify({ repo: 'o/r', pr: 7 })); const timestamp = new Date().toISOString(); const event = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const signature = `sha256=${createHmac('sha256', 's').update(Buffer.concat([Buffer.from(`${TENANT}:${DEFINITION}:${timestamp}:${event}:`), Buffer.from(body)])).digest('hex')}`;
  const delivered = await deliverWebhook(asStore(records), { start: async () => {}, raise: async () => {} }, { tenantId: TENANT, definitionId: DEFINITION, eventId: event, timestamp, signature, body, fallbackSecret: 's' });
  expect((await readRun(records, delivered.runId!)).data.label).toBe('o/r#7');
});
