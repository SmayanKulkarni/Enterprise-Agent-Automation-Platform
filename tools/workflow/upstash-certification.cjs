const { randomUUID } = require('node:crypto');

const required = (key) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing ${key}.`);
  return value;
};
const url = required('UPSTASH_VECTOR_REST_URL').replace(/\/$/u, '');
const token = required('UPSTASH_VECTOR_REST_TOKEN');
const forecast = Number(process.env['WORKFLOW_MEMORY_FORECAST_DAILY_OPERATIONS'] ?? '0');
if (!Number.isFinite(forecast) || forecast < 0 || forecast > 8000) throw new Error('Invalid certification configuration.');
const call = async (command, space, body) => {
  const response = await fetch(`${url}/${command}/${space}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Upstash returned ${response.status}.`);
  return (await response.json()).result;
};
const left = `certification-${randomUUID()}`;
const right = `certification-${randomUUID()}`;
const leftIds = Array.from({ length: 8 }, () => randomUUID());
const rightIds = Array.from({ length: 8 }, () => randomUUID());
const write = (space, id, index) => call('upsert-data', space, { id, data: `certification memory item ${index}`, metadata: { state: 'promoted', source: 'certification' } });
const remove = (space, ids) => call('delete', space, { ids }).catch(() => undefined);
const query = async (index) => {
  const start = performance.now();
  const result = await call('query-data', left, { data: `certification memory item ${index}`, topK: 3, includeMetadata: true, filter: "state = 'promoted'" });
  return { milliseconds: performance.now() - start, result };
};

void (async () => {
  try {
    await Promise.all([...leftIds.map((id, index) => write(left, id, index)), ...rightIds.map((id, index) => write(right, id, index))]);
    await write(left, leftIds[0], 0);
    const count = async () => (await call('fetch', left, { ids: leftIds })).filter(Boolean).length;
    if (await count() !== leftIds.length) throw new Error('Idempotent upsert failed.');
    let probes = [];
    for (let attempt = 0; attempt < 10 && !probes.length; attempt += 1) {
      probes = await Promise.all(Array.from({ length: 10 }, (_, index) => query(index)));
      if (probes.every((probe) => probe.result.length === 0)) { probes = []; await new Promise((resolve) => setTimeout(resolve, 1000)); }
    }
    if (!probes.length) throw new Error('Indexed items never became queryable.');
    const p95 = probes.map((probe) => probe.milliseconds).sort((a, b) => a - b)[Math.ceil(probes.length * 0.95) - 1];
    const returned = probes.flatMap((probe) => probe.result.map((match) => match.id));
    if (!returned.every((id) => leftIds.includes(id))) throw new Error('Namespace isolation failed.');
    if (probes.some((probe) => probe.result.length > 3)) throw new Error('Bounded topK failed.');
    await Promise.all([remove(left, leftIds), remove(right, rightIds)]);
    process.stdout.write(`${JSON.stringify({ provider: 'upstash-vector', namespaceIsolation: true, idempotentUpsert: true, boundedTopK: true, concurrentNodes: leftIds.length, p95Milliseconds: p95, forecastDailyOperations: forecast, quotaHeadroom: 'passed' })}\n`);
  } catch (error) {
    await Promise.all([remove(left, leftIds), remove(right, rightIds)]);
    throw error;
  }
})();
