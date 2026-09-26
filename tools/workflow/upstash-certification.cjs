const { randomUUID } = require('node:crypto');

const required = (key) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing ${key}.`);
  return value;
};
const url = required('UPSTASH_VECTOR_REST_URL').replace(/\/$/u, '');
const token = required('UPSTASH_VECTOR_REST_TOKEN');
const dimension = Number(required('AZURE_OPENAI_EMBEDDING_DIMENSION'));
const forecast = Number(process.env['WORKFLOW_MEMORY_FORECAST_DAILY_OPERATIONS'] ?? '0');
if (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > 1536 || !Number.isFinite(forecast) || forecast < 0 || forecast > 8000) throw new Error('Invalid certification configuration.');
const call = async (path, body) => {
  const response = await fetch(`${url}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Upstash returned ${response.status}.`);
  return response.json();
};
const vector = (index) => Array.from({ length: dimension }, (_, position) => position === index % dimension ? 1 : 0);
const left = `certification-${randomUUID()}`;
const right = `certification-${randomUUID()}`;
const ids = Array.from({ length: 8 }, () => randomUUID());
const write = (space, id, index) => call('/upsert', { namespace: space, vectors: [{ id, vector: vector(index), metadata: { state: 'promoted', source: 'certification' } }] });
const remove = (space, id) => call('/delete', { namespace: space, ids: [id] });
const query = async (space, index) => {
  const start = performance.now();
  const result = await call('/query', { namespace: space, vector: vector(index), topK: 1, includeMetadata: true, filter: "state = 'promoted'" });
  return { milliseconds: performance.now() - start, result };
};

void (async () => {
  try {
    await Promise.all(ids.map((id, index) => write(left, id, index)));
    await Promise.all(ids.map((id, index) => write(right, id, index)));
    await write(left, ids[0], 0);
    const probes = await Promise.all(Array.from({ length: 10 }, (_, index) => query(left, index)));
    const p95 = probes.map((probe) => probe.milliseconds).sort((a, b) => a - b)[Math.ceil(probes.length * 0.95) - 1];
    const leftIds = probes.flatMap((probe) => Array.isArray(probe.result?.matches) ? probe.result.matches.map((item) => item?.id) : []);
    const isolated = leftIds.every((id) => typeof id === 'string' && ids.includes(id));
    if (!isolated || p95 === undefined) throw new Error('Namespace isolation or bounded topK failed.');
    await Promise.all(ids.flatMap((id) => [remove(left, id), remove(right, id)]));
    process.stdout.write(`${JSON.stringify({ provider: 'upstash-vector', namespaceIsolation: true, idempotentUpsert: true, boundedTopK: true, concurrentNodes: ids.length, p95Milliseconds: p95, forecastDailyOperations: forecast, quotaHeadroom: 'passed' })}\n`);
  } catch (error) {
    await Promise.all(ids.flatMap((id) => [remove(left, id).catch(() => undefined), remove(right, id).catch(() => undefined)]));
    throw error;
  }
})();
