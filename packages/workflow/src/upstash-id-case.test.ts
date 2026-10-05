import { afterEach, expect, test, vi } from 'vitest';
import { UpstashVectorMemoryPort } from './ports.js';

const environment = { UPSTASH_VECTOR_REST_URL: 'https://vector.example', UPSTASH_VECTOR_REST_TOKEN: 'token', WORKFLOW_MEMORY_ENABLED_TENANTS: '11111111-1111-4111-8111-111111111111' };
const space = 'tenant-11111111-1111-4111-8111-111111111111';
const upper = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';

afterEach(() => vi.unstubAllGlobals());

test('read, upsert and remove address Upstash by lowercase id even when SQL hands over uppercase', async () => {
  const bodies: unknown[] = [];
  vi.stubGlobal('fetch', (url: string, init: { body: string }) => { bodies.push({ url, ...(JSON.parse(init.body) as object) }); return Promise.resolve(new Response(JSON.stringify({ result: [] }), { status: 200 })); });
  const port = new UpstashVectorMemoryPort(environment);
  await port.read(space, upper);
  await port.remove(space, upper);
  await port.upsert(space, { id: upper, text: 'fact', metadata: { stableDefinitionId: 's', definitionId: 'd', producingRevision: 1, type: 'task-fact', sourceId: 'x', sourceDigest: 'y' } as never });
  expect(JSON.stringify(bodies)).not.toMatch(/AAAAAAAA/u);
  expect(JSON.stringify(bodies)).toContain(upper.toLowerCase());
});
