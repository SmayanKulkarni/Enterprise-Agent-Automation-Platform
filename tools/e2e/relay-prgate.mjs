import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { workflowAdmin as admin, BASE, TENANT, sleep } from './api.mjs';

const stateUrl = new URL('./.state-prgate.json', import.meta.url);
const state = JSON.parse(readFileSync(stateUrl, 'utf8'));
const save = () => writeFileSync(stateUrl, JSON.stringify(state, null, 2));
const definition = state.publishedId.toLowerCase();
const REPO = process.env.PRGATE_REPO ?? 'SmayanKulkarni/pr-gate-demo';
const [owner, repo] = REPO.split('/');
const POLL_MS = 15000;
const PR_LINK_GRACE_MS = 90000;
const gh = (path) => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }));

export async function send(body, { secret = state.secret, eventId = randomUUID(), timestamp = new Date().toISOString() } = {}) {
  const raw = Buffer.from(JSON.stringify(body));
  const signature = `sha256=${createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${TENANT}:${definition}:${timestamp}:${eventId}:`), raw])).digest('hex')}`;
  const response = await fetch(`${BASE}/api/workflow-webhook/${TENANT}/${definition}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-workflow-event-id': eventId, 'x-workflow-timestamp': timestamp, 'x-workflow-signature': signature }, body: raw });
  return { status: response.status, eventId, json: await response.json().catch(() => undefined) };
}

const uuidFrom = (text) => { const hex = createHmac('sha256', 'prgate').update(text).digest('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`; };

function discover() {
  const events = [];
  for (const pr of gh(`repos/${REPO}/pulls?state=open&per_page=30`)) {
    events.push({ key: `pr-${pr.number}-${pr.head.sha}`, body: { kind: 'pull_request', owner, repo, pullNumber: pr.number, headSha: pr.head.sha, title: pr.title, author: pr.user.login } });
  }
  const head = gh(`repos/${REPO}/commits?sha=main&per_page=1`)[0];
  if (state.lastMain && state.lastMain !== head.sha) {
    const { commits } = gh(`repos/${REPO}/compare/${state.lastMain}...${head.sha}`);
    let settled = state.lastMain;
    for (const commit of commits) {
      if (Date.now() - Date.parse(commit.commit.committer.date) < PR_LINK_GRACE_MS) break;
      settled = commit.sha;
      if (gh(`repos/${REPO}/commits/${commit.sha}/pulls`).length > 0) continue;
      events.push({ key: `push-${commit.sha}`, body: { kind: 'push', owner, repo, pullNumber: 0, headSha: commit.sha, title: commit.commit.message.split('\n')[0], author: commit.author?.login ?? commit.commit.author.name } });
    }
    state.lastMain = settled;
  } else state.lastMain ??= head.sha;
  return events;
}

async function tick() {
  state.sent ??= {};
  for (const event of discover()) {
    if (state.sent[event.key]) continue;
    const result = await send(event.body, { eventId: uuidFrom(`${definition}:${event.key}`) });
    console.log(new Date().toISOString(), event.key, '->', result.status, result.json?.runId ?? JSON.stringify(result.json ?? {}));
    if (result.status === 202) state.sent[event.key] = result.json?.runId ?? true;
  }
  save();
}

const command = process.argv[2];
if (command === 'provision') {
  const receipt = await admin.command('workflow', 'provision-webhook-credential', { id: state.publishedId }, { expectedVersion: 0 });
  state.secret = receipt.webhookSecret; save();
  console.log('credential provisioned');
} else if (command === 'once') await tick();
else if (command === 'watch') for (;;) { try { await tick(); } catch (error) { console.error('relay tick failed:', error.message); } await sleep(POLL_MS); }
else if (command === 'negatives') {
  const good = { kind: 'push', owner, repo, pullNumber: 0, headSha: '0'.repeat(40), title: 'negative test', author: 'nobody' };
  console.log('wrong secret      ->', (await send(good, { secret: 'not-the-secret' })).status, '(403)');
  console.log('stale timestamp   ->', (await send(good, { timestamp: new Date(Date.now() - 3600000).toISOString() })).status, '(403)');
  console.log('schema violation  ->', (await send({ owner })).status, '(400)');
  console.log('wrong type        ->', (await send({ ...good, pullNumber: '3' })).status, '(400)');
  console.log('unknown definition->', (await fetch(`${BASE}/api/workflow-webhook/${TENANT}/${randomUUID()}`, { method: 'POST', body: '{}' })).status, '(404 or 400)');
}
else if (command === 'baseline') { state.lastMain = gh(`repos/${REPO}/commits?sha=main&per_page=1`)[0].sha; save(); console.log('main baseline', state.lastMain); }
