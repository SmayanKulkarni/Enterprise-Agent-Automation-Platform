import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = resolve(ROOT, 'tools/workspace/lint-baseline.json');
const MAX_BUFFER = 512 * 1024 * 1024;

/** @typedef {Record<string, number>} Counts */
/** @param {readonly { filePath: string, messages: readonly { severity: number }[] }[]} results @returns {Counts} */
export const errorCounts = (results) => Object.fromEntries(
  results.flatMap((file) => {
    const count = file.messages.filter((message) => message.severity === 2).length;
    return count > 0 ? [[relative(ROOT, file.filePath), count]] : [];
  }),
);

/** @param {Counts} current @param {Counts} baseline */
export const regressions = (current, baseline) => Object.entries(current)
  .filter(([file, count]) => count > (baseline[file] ?? 0))
  .map(([file, count]) => ({ file, count, allowed: baseline[file] ?? 0 }));

/** @param {Counts} current @param {Counts} baseline */
export const improvements = (current, baseline) => Object.entries(baseline)
  .filter(([file, allowed]) => (current[file] ?? 0) < allowed)
  .map(([file, allowed]) => ({ file, count: current[file] ?? 0, allowed }));

function current() {
  const run = spawnSync(resolve(ROOT, 'node_modules/.bin/eslint'), ['.', '-f', 'json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: MAX_BUFFER });
  if (run.error || !run.stdout) throw new Error(`eslint did not produce a report: ${run.stderr || run.error?.message}`);
  return errorCounts(JSON.parse(run.stdout));
}

function main() {
  const counts = current();
  if (process.argv.includes('--update')) {
    writeFileSync(BASELINE, `${JSON.stringify(Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))), null, 2)}\n`);
    console.log(`lint baseline written: ${Object.keys(counts).length} files, ${Object.values(counts).reduce((sum, value) => sum + value, 0)} errors`);
    return 0;
  }
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const worse = regressions(counts, baseline);
  for (const item of worse) console.error(`lint: ${item.file} has ${item.count} errors, baseline allows ${item.allowed}`);
  const better = improvements(counts, baseline);
  if (better.length) console.log(`lint: ${better.length} file(s) improved; run "node tools/workspace/lint-ratchet.mjs --update" to lock it in`);
  if (worse.length) return 1;
  console.log('lint ratchet passed: no file has more errors than its baseline');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
