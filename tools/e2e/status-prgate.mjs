import { workflowAdmin as admin } from './api.mjs';

const wanted = process.argv.slice(2).map((item) => item.toLowerCase());
const runs = await admin.projection('workflow-runs');
for (const run of runs.filter((item) => wanted.length === 0 || wanted.some((id) => item.id.toLowerCase().startsWith(id)))) {
  const last = run.history.at(-1);
  console.log(run.id.slice(0, 8), run.status, `events=${run.history.length}`, `last=${last?.nodeId}:${last?.kind}:${last?.state}`, run.waiting ? `WAITING ${run.waiting.nodeId} ${run.waiting.review?.capability}` : '');
}
