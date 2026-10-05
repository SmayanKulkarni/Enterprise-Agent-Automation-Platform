import { readFileSync } from 'node:fs';
import { workflowAdmin as admin, randomUUID, sleep } from './api.mjs';

const { publishedId } = JSON.parse(readFileSync(new URL('./.state.json', import.meta.url), 'utf8'));
const [pkg = 'zod', question = 'Is this safe to adopt as our schema validation library?'] = process.argv.slice(2);
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'expired', 'unknown-outcome']);

const runId = process.env.RUN_ID ?? randomUUID();
if (!process.env.RUN_ID) {
  const started = await admin.command('workflow', 'start', { id: publishedId, input: { package: pkg, question } }, { key: runId });
  console.log('run queued', started.objectId);
}

const approved = new Set();
let seen = 0;
for (let tick = 0; tick < 240; tick += 1) {
  await sleep(2500);
  const run = (await admin.projection('workflow-runs').catch(() => [])).find((item) => item.id.toLowerCase() === runId.toLowerCase());
  if (!run) continue;
  const last = run.history.at(-1);
  if (run.history.length !== seen) { seen = run.history.length; console.log(`${run.status} events=${seen} last=${last?.nodeId}:${last?.kind}:${last?.state}`); }
  if (!process.env.NO_APPROVE && (!process.env.APPROVE_NODES || process.env.APPROVE_NODES.split(',').includes(run.waiting?.nodeId)) && run.status === 'waiting-approval' && run.waiting && !approved.has(run.waiting.bindingDigest)) {
    console.log(`\napproval requested: ${run.waiting.review?.capability} target=${run.waiting.review?.target}`);
    approved.add(run.waiting.bindingDigest);
    await admin.command('workflow', 'approve', { id: runId, bindingDigest: run.waiting.bindingDigest, decision: 'approve' }, { expectedVersion: run.version });
    console.log('approved by workflow admin');
  }
  if (TERMINAL.has(run.status)) {
    console.log('\nFINAL', run.status, 'summary:', run.summaryStatus, 'usage:', JSON.stringify(run.usage));
    console.log('effects:', run.effects.map((effect) => `${effect.nodeId}:${effect.state}`).join(', '));
    console.log('retrievals:', JSON.stringify(run.retrievals));
    console.log(run.history.map((item) => `${item.nodeId}/${item.kind}/${item.state}${item.detail ? `/${String(item.detail).slice(0, 60)}` : ''}`).join('\n'));
    process.exit(run.status === 'completed' ? 0 : 2);
  }
}
console.log('\ntimeout');
process.exit(3);
