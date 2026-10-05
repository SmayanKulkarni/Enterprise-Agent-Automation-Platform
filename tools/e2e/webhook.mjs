import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { workflowAdmin as admin, randomUUID, BASE, TENANT } from './api.mjs';

const stateUrl = new URL('./.state-github.json', import.meta.url);
const state = JSON.parse(readFileSync(stateUrl, 'utf8'));
const save = () => writeFileSync(stateUrl, JSON.stringify(state, null, 2));
const definition = state.publishedId.toLowerCase();

export async function send(body, { secret = state.secret, eventId = randomUUID(), timestamp = new Date().toISOString(), tamper = false } = {}) {
  const raw = Buffer.from(JSON.stringify(body));
  const signature = `sha256=${createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${TENANT}:${definition}:${timestamp}:${eventId}:`), raw])).digest('hex')}`;
  const response = await fetch(`${BASE}/api/workflow-webhook/${TENANT}/${definition}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-workflow-event-id': eventId, 'x-workflow-timestamp': timestamp, 'x-workflow-signature': signature }, body: tamper ? Buffer.from(JSON.stringify({ ...body, focus: 'tampered' })) : raw });
  return { status: response.status, eventId, json: await response.json().catch(() => undefined) };
}

const command = process.argv[2];
if (command === 'provision') {
  const receipt = await admin.command('workflow', 'provision-webhook-credential', { id: state.publishedId }, { expectedVersion: 0 });
  state.secret = receipt.webhookSecret; save();
  console.log('credential provisioned, secret shown once:', receipt.webhookSecret ? `${receipt.webhookSecret.length} chars saved locally` : 'MISSING');
} else if (command === 'send') {
  const [owner, repo, ...focus] = process.argv.slice(3);
  const result = await send({ owner, repo, focus: focus.join(' ') || 'Is this repository healthy?' });
  console.log(JSON.stringify(result));
} else if (command === 'negatives') {
  const good = { owner: 'octocat', repo: 'Hello-World', focus: 'negative test' };
  const accepted = await send(good); console.log('valid signature       ->', accepted.status, accepted.json?.runId ? 'run queued' : '');
  console.log('replay same event     ->', (await send(good, { eventId: accepted.eventId })).status, '(202 = idempotent replay)');
  console.log('wrong secret          ->', (await send(good, { secret: 'not-the-secret' })).status, '(403 expected)');
  console.log('tampered body         ->', (await send(good, { tamper: true })).status, '(403 expected)');
  console.log('stale timestamp       ->', (await send(good, { timestamp: new Date(Date.now() - 3600000).toISOString() })).status, '(403 expected)');
  console.log('schema violation      ->', (await send({ owner: 'x' })).status, '(400 expected)');
  const rotate = await admin.command('workflow', 'rotate-webhook-credential', { id: state.publishedId }, { expectedVersion: 1 });
  const previous = state.secret; state.secret = rotate.webhookSecret; save();
  console.log('after rotate: new key ->', (await send(good, { eventId: accepted.eventId })).status, '| old key within grace ->', (await send(good, { secret: previous, eventId: accepted.eventId })).status, '(both 202 expected)');
  console.log('accepted run id', accepted.json?.runId);
}
