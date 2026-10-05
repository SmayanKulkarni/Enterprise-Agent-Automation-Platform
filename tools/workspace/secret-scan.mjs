import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_BYTES = 1024 * 1024;
const SKIP = /(?:^|\/)(?:pnpm-lock\.yaml|graphify-out\/|\.vitest\/|\.vercel\/|\.pnpm-store\/|node_modules\/)|\.(?:png|jpe?g|gif|ico|woff2?|pdf|zip|drawio|jam|map|sqlite)$/u;

/** @type {readonly (readonly [string, RegExp])[]} */
export const PATTERNS = [
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/u],
  ['Stripe live key', /\bsk_live_[0-9A-Za-z]{16,}/u],
  ['OpenRouter key', /\bsk-or-v1-[0-9a-f]{32,}/u],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}/u],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{50,}/u],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/u],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/u],
];

/** @param {string} text @returns {string[]} */
export const scan = (text) => PATTERNS.flatMap(([name, pattern]) => pattern.test(text) ? [name] : []);

function tracked() {
  const run = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error('git ls-files failed');
  return run.stdout.split('\0').filter((file) => file && !SKIP.test(file));
}

function main() {
  const findings = [];
  for (const file of tracked()) {
    let text;
    try { if (statSync(resolve(ROOT, file)).size > MAX_BYTES) continue; text = readFileSync(resolve(ROOT, file), 'utf8'); } catch { continue; }
    for (const name of scan(text)) findings.push(`${file}: ${name}`);
  }
  for (const finding of findings) console.error(`secret-scan: ${finding}`);
  if (findings.length) return 1;
  console.log('secret scan passed');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
