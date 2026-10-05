import { spawnSync } from 'node:child_process';

if (process.env.E2E_MEMORY_SCENARIO !== '1') throw new Error('Set E2E_MEMORY_SCENARIO=1 to run the six-run live memory scenario.');
const runs = [
  ['zod', 'Is zod safe to adopt as our schema validation library?'],
  ['lodash', 'Is lodash safe to adopt as our utility library?'],
  ['zod', 'Is zod still safe to adopt?'],
  ['zod', 'Has the zod advisory picture changed since the last briefing?'],
  ['express', 'Is express safe to adopt as our HTTP framework?'],
  ['this-package-does-not-exist-9c1d', 'Is this package safe to adopt?'],
];
for (const [index, [pkg, question]] of runs.entries()) {
  const result = spawnSync('node', ['tools/e2e/run.mjs', pkg, question], { stdio: 'inherit', env: process.env });
  console.log(`scenario run ${index + 1}/${runs.length} (${pkg}) exited ${result.status}`);
}
const tenantId = process.env.PLATFORM_TENANT_ID;
if (tenantId) spawnSync('node', ['tools/workflow/memory-report.mjs', tenantId, '--out', `outputs/memory-reports/${new Date().toISOString().replaceAll(':', '-')}.json`], { stdio: 'inherit', env: process.env });
else console.log('Set PLATFORM_TENANT_ID to print the memory report after the runs.');
