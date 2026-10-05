import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { memoryReport } from './memory-metrics.mjs';

const PAGE = 100;
const [tenantId, ...flags] = process.argv.slice(2);
if (!tenantId || !/^[0-9a-f-]{36}$/iu.test(tenantId)) throw new Error('Usage: node tools/workflow/memory-report.mjs <tenant-uuid> [--out file.json]');
/** @param {string} key */
const required = (key) => process.env[key]?.trim() || (() => { throw new Error(`Missing ${key}.`); })();
const url = required('UPSTASH_VECTOR_REST_URL').replace(/\/$/u, '');
const token = required('UPSTASH_VECTOR_REST_TOKEN');
const out = flags[0] === '--out' ? flags[1] : undefined;

/** @param {string} cursor */
const range = async (cursor) => {
  const response = await globalThis.fetch(`${url}/range/tenant-${tenantId}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ cursor, limit: PAGE, includeMetadata: true }), signal: globalThis.AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Upstash returned ${response.status}.`);
  const { result } = await response.json();
  return result;
};

const rows = [];
let cursor = '0';
do {
  const page = await range(cursor);
  for (const vector of page.vectors) {
    const metadata = vector.metadata ?? {};
    rows.push({ id: vector.id, text: String(metadata.text ?? ''), subjects: Array.isArray(metadata.subjects) ? metadata.subjects.map(String) : [], type: String(metadata.type ?? 'unknown'), state: String(metadata.state ?? 'unknown'), legacy: metadata.schemaVersion !== 2 });
  }
  cursor = page.nextCursor;
} while (cursor);

const active = rows.filter((row) => row.state === 'promoted');
const report = { tenantId, vectors: rows.length, active: active.length, legacyActive: active.filter((row) => row.legacy).length, v2: memoryReport(active.filter((row) => !row.legacy)), all: memoryReport(active) };
const text = JSON.stringify(report, null, 2);
if (out) { await mkdir(dirname(out), { recursive: true }); await writeFile(out, text); }
console.log(text);
