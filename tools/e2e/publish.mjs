import { writeFileSync } from 'node:fs';
import { workflowAdmin as admin, randomUUID } from './api.mjs';
import { buildGraph, TOOLS } from './graph.mjs';

const installationId = process.env.MCP_INSTALLATION_ID;
const [installation] = (await admin.projection('connector-installations')).filter((item) => item.id.toLowerCase() === installationId);
const manifestDigest = installation.manifest.digest;
const grants = Object.fromEntries(TOOLS.map((item) => [item.id, randomUUID()]));
const draftId = randomUUID();
const graph = buildGraph({ installationId, manifestDigest, grants });

const created = await admin.command('studio', 'create-draft', { id: draftId, draft: graph });
console.log('draft created: revision', created.revision);

for (const item of TOOLS) await admin.command('workflow', 'grant', { id: draftId, nodeId: item.id, installationId, capability: item.capability }, { key: grants[item.id] });
console.log('grants issued:', TOOLS.length);

const check = await admin.command('workflow', 'check', { id: draftId }, { expectedVersion: created.revision });
console.log('check:', check.state, JSON.stringify(check.issues ?? []).slice(0, 800));
if (check.state !== 'passed') process.exit(1);

const published = await admin.command('workflow', 'publish', { id: draftId, reviewDigest: check.digest }, { expectedVersion: created.revision });
console.log('published definition', published.objectId, 'revision', published.revision);
writeFileSync(new URL('./.state.json', import.meta.url), JSON.stringify({ draftId, publishedId: published.objectId, revision: created.revision }, null, 2));
