import { expect, test } from 'vitest';
import { AppError } from '../../errors/src/app-error.js';
import { DEMO_TENANT_ID, SAMPLE_DIFF, SAMPLE_PULL_REQUEST, runDemo } from '../../workflow/src/pr-gate-demo.js';
import { handleDemoRead, type DemoReadDeps } from './demo-read.js';

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const RUN = runDemo({ id: 'e0000000-0000-4000-8000-000000000001', now: NOW - 60_000, pullRequest: SAMPLE_PULL_REQUEST, diff: SAMPLE_DIFF, source: 'sample' });

const harness = (overrides: Partial<DemoReadDeps> = {}) => {
  const reads: { collection: string; query: Record<string, string>; context: { tenantIds: readonly string[] } }[] = [];
  const deps: DemoReadDeps = {
    own: (key) => Promise.resolve(key.length === 32 ? RUN : undefined),
    summary: () => Promise.resolve({ buckets: [{ start: new Date(NOW - 3_600_000), runs: 2 }], current: 3, previous: 1 }),
    governance: { read: (context, collection, query) => { reads.push({ collection, query: { ...query }, context }); return Promise.resolve({ status: 'ready', series: [], classification: 'fixture' }); } },
    allow: () => true,
    now: () => NOW,
    pepper: 'test-pepper',
    ...overrides,
  };
  return { deps, reads };
};
const get = (target: string, query: Record<string, string> = {}) => ({ ip: '203.0.113.9' as string | undefined, target, query });

test('the own run is returned for the caller address only', async () => {
  const { deps } = harness({ own: (key) => Promise.resolve(key === 'k'.repeat(32) ? RUN : undefined) });
  expect(await handleDemoRead(get('run'), deps)).toMatchObject({ status: 404, body: { error: { code: 'NOT_FOUND' } } });
  const found = await handleDemoRead(get('run'), { ...deps, own: () => Promise.resolve(RUN) });
  expect(found).toEqual({ status: 200, body: { run: RUN } });
});

test('a missing address fails closed and a limited address is refused before any work', async () => {
  let reads = 0;
  const { deps } = harness({ own: () => { reads += 1; return Promise.resolve(RUN); } });
  expect(await handleDemoRead({ ...get('run'), ip: undefined }, deps)).toMatchObject({ status: 503 });
  expect(await handleDemoRead(get('run'), { ...deps, allow: () => false })).toMatchObject({ status: 429, body: { error: { code: 'RATE_LIMITED' } } });
  expect(reads).toBe(0);
});

test('overview and workflows come from the stored run counts', async () => {
  const { deps } = harness();
  const overview = await handleDemoRead(get('overview', { range: '24h' }), deps);
  expect(overview.status).toBe(200);
  expect(overview.body).toMatchObject({ range: '24h', total: { runs: 3, previous: { runs: 1 }, pendingApprovals: 0 }, workspaces: [{ tenantId: DEMO_TENANT_ID, runs: 3 }] });
  const workflows = await handleDemoRead(get('workflows', { range: '24h' }), deps);
  expect(workflows.body).toMatchObject({ workflows: [{ tenantId: DEMO_TENANT_ID, name: 'PR gate', runs: 3 }] });
});

test('runs over time is a gap-free grid of the stored bucket counts', async () => {
  const { deps } = harness();
  const reply = await handleDemoRead(get('series', { panel: 'runs-over-time', range: '24h' }), deps);
  const body = reply.body as { status: string; series: { label: string; points: [number, number][] }[] };
  expect(body.status).toBe('ready');
  expect(body.series[0]?.points.length).toBe(288);
  expect(body.series[0]?.points.reduce((sum, [, value]) => sum + value, 0)).toBe(2);
});

test('telemetry panels, logs and traces are read for the demo tenant only', async () => {
  const { deps, reads } = harness();
  await handleDemoRead(get('series', { panel: 'model-latency', range: '24h' }), deps);
  await handleDemoRead(get('logs', { range: '24h', level: 'info' }), deps);
  await handleDemoRead(get('trace', { run: RUN.id }), deps);
  expect(reads.map((read) => read.collection)).toEqual(['series', 'logs', 'trace']);
  expect(reads.every((read) => read.context.tenantIds.length === 1 && read.context.tenantIds[0] === DEMO_TENANT_ID)).toBe(true);
});

test.each([
  ['an unknown collection', 'members', { range: '24h' }],
  ['an unknown range', 'overview', { range: '1y' }],
  ['an unknown parameter', 'overview', { range: '24h', tenant: 'x' }],
  ['a missing panel', 'series', { range: '24h' }],
  ['an oversized query', 'logs', { range: '24h', event: 'x'.repeat(600) }],
])('%s is invalid and reaches no backend', async (_name, target, query) => {
  const { deps, reads } = harness();
  expect(await handleDemoRead(get(target, query), deps)).toMatchObject({ status: 400, body: { error: { code: 'INVALID_INPUT' } } });
  expect(reads).toEqual([]);
});

test('a rejected query from the governance service is invalid, any other failure is unavailable', async () => {
  const invalid = harness({ governance: { read: () => Promise.reject(new AppError('INVALID')) } });
  expect(await handleDemoRead(get('logs', { range: '24h', level: 'nope' }), invalid.deps)).toMatchObject({ status: 400 });
  const broken = harness({ summary: () => Promise.reject(new Error('SQL down')) });
  expect(await handleDemoRead(get('overview', { range: '24h' }), broken.deps)).toMatchObject({ status: 503, body: { error: { code: 'DEMO_UNAVAILABLE' } } });
});
