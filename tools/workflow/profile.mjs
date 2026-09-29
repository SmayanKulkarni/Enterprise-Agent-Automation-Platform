import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const directory = join(root, 'outputs', 'profiles', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(directory, { recursive: true });

const run = spawnSync(process.execPath, [
  '--cpu-prof',
  `--cpu-prof-dir=${directory}`,
  '--cpu-prof-interval=100',
  join(root, 'node_modules', 'vitest', 'vitest.mjs'),
  'run',
  'packages/workflow/src/workflow-e2e.test.ts',
], { cwd: root, stdio: 'inherit', env: { ...process.env, PROFILE_REPEAT: process.env['PROFILE_REPEAT'] ?? '200' } });
if (run.status !== 0) process.exit(run.status ?? 1);

const files = readdirSync(directory).filter((name) => name.endsWith('.cpuprofile'));
if (files.length === 0) { console.error('No CPU profile was written.'); process.exit(1); }

const selfTime = new Map();
for (const name of files) {
  const profile = JSON.parse(readFileSync(join(directory, name), 'utf8'));
  const frames = new Map();
  for (const node of profile.nodes) frames.set(node.id, node.callFrame);
  for (const [index, id] of profile.samples.entries()) {
    const frame = frames.get(id);
    const source = /\/packages\/[^/]+\/src\/[^?]+/u.exec(decodeURIComponent(frame.url))?.[0];
    if (!source) continue;
    const key = `${source}  ${frame.functionName || '(anonymous)'}`;
    selfTime.set(key, (selfTime.get(key) ?? 0) + profile.timeDeltas[index]);
  }
}
if (selfTime.size === 0) { console.error('Profile contains no repository frames.'); process.exit(1); }

const top = [...selfTime].sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log(top.map(([key, micros]) => `${(micros / 1000).toFixed(1).padStart(8)} ms  ${key}`).join('\n'));
console.log(`\nprofiles: ${directory}\nflamegraph: pnpm dlx speedscope ${join(directory, `${files[0]}`)}`);
