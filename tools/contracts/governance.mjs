import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const registryPath = resolve(root, 'docs/contracts/cross-subsystem-contract-registry.md');
const schemaDirectory = resolve(root, 'docs/contracts/v1/schemas');
/** @param {string} code @param {string} message @returns {never} */
const output = (code, message) => { throw new Error(`${code}: ${message}`); };

/** @param {string} markdown */
function registryContracts(markdown) {
  const matches = [...markdown.matchAll(/^\| `([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+)` \| P ([^;|]+); C ([^|]+) \| (ordinary|restricted-operational|secret|immutable-audit) \|/gmu)];
  if (matches.length === 0) output('REGISTRY_INVALID', 'No owned contract entries found.');
  return matches.map((match) => {
    const [name = '', producer = '', consumer = '', classification = ''] = [match[1], match[2], match[3], match[4]];
    if ([name, producer, consumer, classification].some((value) => value === '')) output('REGISTRY_INVALID', 'Incomplete contract entry.');
    return { classification, consumer, name, producer };
  });
}

/** @param {string} markdown */
function markdownLinks(markdown) {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/gu)].map((match) => match[1]).filter((link) => link !== undefined);
}

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

const registry = readFileSync(registryPath, 'utf8');
const entries = registryContracts(registry);
for (const entry of entries) if (entry.producer.trim() === '' || entry.consumer.trim() === '') output('REGISTRY_OWNER_CONSUMER_INVALID', entry.name);
for (const link of markdownLinks(registry)) if (!link.startsWith('http') && !existsSync(resolve(dirname(registryPath), link))) output('BROKEN_DOCUMENT_LINK', link);
for (const file of readdirSync(schemaDirectory)) JSON.parse(readFileSync(resolve(schemaDirectory, file ?? ''), 'utf8'));
const packed = await import(resolve(root, 'packages/contracts/dist/index.js'));
const declared = Object.keys(packed.CONTRACT_DESCRIPTORS).sort();
const registered = entries.map(({ name }) => name).sort();
if (JSON.stringify(declared) !== JSON.stringify(registered)) output('CONTRACT_METADATA_DRIFT', 'Packed descriptors differ from the registry.');
for (const entry of entries) if (packed.descriptorFor(entry.name).classification !== entry.classification) output('CONTRACT_METADATA_DRIFT', entry.name);
const secretFindings = scanSecrets(resolve(root, 'packages'));
if (secretFindings.length > 0) output('SECRET_SCAN_FAILED', secretFindings.join(', '));
const report = { artifactDigest: createHash('sha256').update(readFileSync(resolve(root, 'packages/contracts/dist/index.js'))).digest('hex'), contracts: entries.map(({ classification, consumer, name, producer }) => ({ classification, consumer, name, owner: 'Platform', producer })), schemas: readdirSync(schemaDirectory).sort(), secretScan: { findings: secretFindings, passed: true } };
console.log(JSON.stringify(report));
