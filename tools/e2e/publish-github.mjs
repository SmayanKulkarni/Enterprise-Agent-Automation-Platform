import { writeFileSync } from 'node:fs';
import { workflowAdmin as admin, randomUUID } from './api.mjs';
import { buildGraph, TOOLS } from './graph-github.mjs';

const list = await admin.projection('connector-installations');
const pick = (id) => { const found = list.find((item) => item.id.toLowerCase() === id.toLowerCase()); return { id: found.id.toLowerCase(), digest: found.manifest.digest }; };
const installations = { github: pick(process.env.GITHUB_MCP_INSTALLATION_ID), files: pick(process.env.MCP_INSTALLATION_ID) };
const nodes = [...TOOLS.map((item) => ({ id: item.id, capability: item.capability, site: item.site })), { id: 'branches', capability: 'list_branches', site: 'github' }];
const grants = Object.fromEntries(nodes.map((item) => [item.id, randomUUID()]));
const draftId = randomUUID();
const created = await admin.command('studio', 'create-draft', { id: draftId, draft: buildGraph({ installations, grants }) });
for (const item of nodes) await admin.command('workflow', 'grant', { id: draftId, nodeId: item.id, installationId: installations[item.site].id, capability: item.capability }, { key: grants[item.id] });
console.log('draft', draftId, 'grants', nodes.length);
const check = await admin.command('workflow', 'check', { id: draftId }, { expectedVersion: created.revision });
console.log('check:', check.state, JSON.stringify(check.issues ?? []).slice(0, 900));
if (check.state !== 'passed') process.exit(1);
const published = await admin.command('workflow', 'publish', { id: draftId, reviewDigest: check.digest }, { expectedVersion: created.revision });
console.log('published', published.objectId);
writeFileSync(new URL('./.state-github.json', import.meta.url), JSON.stringify({ draftId, publishedId: published.objectId }, null, 2));
