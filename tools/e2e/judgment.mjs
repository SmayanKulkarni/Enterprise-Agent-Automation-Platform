import { workflowAdmin as admin, randomUUID, sleep } from './api.mjs';

const MODEL = process.env.JUDGMENT_MODEL ?? 'typesafe/jev-1.13';
const TICKET = process.argv[2] ?? 'My order arrived broken and I want my money back. Please refund order 4417 today.';
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'expired', 'unknown-outcome']);

const node = (id, kind, title, detail, x, y, config, instructions = '') => ({ id, kind, title, detail, x, y, instructions, config });
const edge = (id, from, to, branch) => ({ id, from, to, ...(branch ? { branch } : {}) });

const graph = {
  kind: 'graph-v1',
  nodes: [
    node('intake', 'trigger', 'Ticket', 'ticket text', 40, 200, { mode: 'manual', inputSchema: { type: 'object', properties: { ticket: { type: 'string' } }, required: ['ticket'], additionalProperties: false } }),
    node('triage', 'judgment', 'Triage ticket', 'Decision model', 300, 200, {
      provider: 'openrouter', openRouterOptIn: true, model: MODEL,
      questions: {
        team: { type: 'choice', instructions: 'Which team should handle the ticket in `ticket`? Pick none when it is not a support request.', criteria: { billing: 'Charges, invoices, refunds', technical: 'Errors or outages', none: 'Not a support request' } },
        refund_ask: { type: 'noul', instructions: 'Does the customer in `ticket` explicitly ask for money back?', thresholds: { act: 0.9, review: 0.7 } },
        urgency: { type: 'score', instructions: 'How urgent is the ticket in `ticket`?', criteria: ['Can wait a week', 'Needs a reply today', 'Customer is blocked now'], gate: false },
      },
      state: { ticket: '$input.ticket' },
      thresholds: { act: 0.85, review: 0.6 },
      policy: { milliseconds: 15000, attempts: 2, tokens: 8000, cost: 0.01, toolRounds: 0, effects: 0 },
    }),
    node('gate', 'condition', 'Confident?', 'band is act', 560, 200, { source: 'triage', field: 'band', equals: 'act' }),
    node('end_auto', 'end', 'Routed', 'confident', 800, 120, {}),
    node('end_review', 'end', 'Needs human', 'review or escalate', 800, 300, {}),
  ],
  edges: [edge('e1', 'intake', 'triage'), edge('e2', 'triage', 'gate'), edge('e3', 'gate', 'end_auto', 'true'), edge('e4', 'gate', 'end_review', 'false')],
};

const draftId = randomUUID();
const created = await admin.command('studio', 'create-draft', { id: draftId, draft: graph });
const check = await admin.command('workflow', 'check', { id: draftId }, { expectedVersion: created.revision });
console.log('check:', check.state, JSON.stringify(check.issues ?? []).slice(0, 800));
if (check.state !== 'passed') process.exit(1);
const published = await admin.command('workflow', 'publish', { id: draftId, reviewDigest: check.digest }, { expectedVersion: created.revision });
console.log('published', published.objectId);

const runId = randomUUID();
await admin.command('workflow', 'start', { id: published.objectId, input: { ticket: TICKET } }, { key: runId });
console.log('run queued', runId);

for (let tick = 0; tick < 60; tick += 1) {
  await sleep(2000);
  const run = (await admin.projection('workflow-runs').catch(() => [])).find((item) => item.id.toLowerCase() === runId.toLowerCase());
  if (!run || !TERMINAL.has(run.status)) continue;
  console.log('\nFINAL', run.status, 'usage:', JSON.stringify(run.usage));
  console.log(run.history.map((item) => `${item.nodeId}/${item.kind}/${item.state}${item.detail ? `/${String(item.detail).slice(0, 80)}` : ''}`).join('\n'));
  process.exit(run.status === 'completed' ? 0 : 2);
}
console.log('\ntimeout');
process.exit(3);
