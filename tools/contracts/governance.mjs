import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** @param {string} code @param {string} message @returns {never} */
const output = (code, message) => { throw new Error(`${code}: ${message}`); };

/** @param {string} directory @returns {string[]} */
function scanSecrets(directory) {
  const findings = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.scratch', '.superpowers'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) findings.push(...scanSecrets(path));
    else if (entry.isFile() && /(api[_-]?key|private[_-]?key|password)\s*[:=]\s*[^\s"']{8,}/iu.test(readFileSync(path, 'utf8'))) findings.push(relative(root, path));
  }
  return findings;
}

const packed = await import(resolve(root, 'packages/contracts/dist/index.js'));
const declared = Object.keys(packed.CONTRACT_DESCRIPTORS).sort();
if (declared.length === 0) output('CONTRACT_METADATA_INVALID', 'No contract descriptors were exported.');
for (const name of declared) {
  const descriptor = packed.descriptorFor(name);
  if (descriptor.name !== name || !descriptor.tenantScoped || descriptor.version !== '1.0.0') output('CONTRACT_METADATA_DRIFT', name);
}
const secretFindings = scanSecrets(resolve(root, 'packages'));
if (secretFindings.length > 0) output('SECRET_SCAN_FAILED', secretFindings.join(', '));
const report = { artifactDigest: createHash('sha256').update(readFileSync(resolve(root, 'packages/contracts/dist/index.js'))).digest('hex'), contracts: declared.map((name) => ({ ...packed.descriptorFor(name), owner: 'Platform' })), secretScan: { findings: secretFindings, passed: true } };
console.log(JSON.stringify(report));
