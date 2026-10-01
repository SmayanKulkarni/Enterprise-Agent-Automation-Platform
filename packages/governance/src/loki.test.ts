import { afterEach, expect, test, vi } from 'vitest';

vi.mock('../../errors/src/report.js', () => ({ report: vi.fn() }));
const { report } = await import('../../errors/src/report.js');
const { lokiLogs, lokiQuery } = await import('./loki.js');

const tenant = '11111111-1111-4111-8111-111111111111';
const run = '33333333-3333-4333-8333-333333333333';
const streams = (result: unknown, resultType = 'streams') => ({ status: 'success', data: { resultType, result } });
const respond = (body: unknown, status = 200) => vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
const read = () => lokiLogs({ url: 'http://loki.invalid' }, '{x="y"}', 1n, 2_000_000_000_000_000_000n, 201);

afterEach(() => { vi.unstubAllGlobals(); vi.mocked(report).mockClear(); });

test('builds the exact query with every filter', () => {
  expect(lokiQuery(tenant, { level: 'warn', event: 'run.finished', run })).toBe(`{service_namespace="threadline"} | tenant_id=~"${tenant}" | level="warn" | event="run.finished" | run_id="${run}"`);
  expect(lokiQuery(tenant, {})).toBe(`{service_namespace="threadline"} | tenant_id=~"${tenant}"`);
});

test.each([
  ['level', { level: 'info"} | x=~".*' }],
  ['event', { event: 'nope' }],
  ['run', { run: 'abc' }],
])('refuses a hostile %s', (_name, filters) => {
  expect(() => lokiQuery(tenant, filters)).toThrow(expect.objectContaining({ code: 'INVALID' }));
});

test('projects lines through the allowlist, drops unknown events and reads structured metadata', async () => {
  vi.stubGlobal('fetch', respond(streams([
    { stream: { event: 'run.started', level: 'info', tenant_id: tenant, run_id: run }, values: [['1700000000000000002', 'run.started', { prompt: 'secret', definition_id: 'd1' }]] },
    { stream: { event: 'made.up', level: 'info' }, values: [['1700000000000000003', 'made.up']] },
  ])));

  const result = await read();

  expect(result).toEqual({ status: 'ready', entries: [{ at: '2023-11-14T22:13:20.000Z', ns: '1700000000000000002', event: 'run.started', level: 'info', attributes: { tenant_id: tenant, run_id: run, definition_id: 'd1' } }] });
});

test('keeps nanosecond timestamps exact and sorts newest first across streams', async () => {
  vi.stubGlobal('fetch', respond(streams([
    { stream: { event: 'run.started', level: 'info' }, values: [['1700000000000000001', 'run.started'], ['1700000000000000005', 'run.started']] },
    { stream: { event: 'run.finished', level: 'warn', duration_s: '4.5', status: 'completed' }, values: [['1700000000000000003', 'run.finished']] },
  ])));

  const result = await read();

  expect(result.entries.map((entry) => entry.ns)).toEqual(['1700000000000000005', '1700000000000000003', '1700000000000000001']);
  expect(result.entries[1]).toMatchObject({ level: 'warn', attributes: { duration_s: 4.5, status: 'completed' } });
});

test('sends nanosecond bounds, limit and backward direction', async () => {
  const fetchMock = respond(streams([]));
  vi.stubGlobal('fetch', fetchMock);

  await read();

  const url = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
  expect(url.pathname).toBe('/loki/api/v1/query_range');
  expect(Object.fromEntries(url.searchParams)).toEqual({ query: '{x="y"}', start: '1', end: '2000000000000000000', limit: '201', direction: 'backward' });
});

test.each([
  ['a 500', () => respond({}, 500)],
  ['a matrix result', () => respond(streams([], 'matrix'))],
])('answers unavailable with one report for %s', async (_name, make) => {
  vi.stubGlobal('fetch', make());

  expect(await read()).toEqual({ status: 'unavailable', entries: [] });
  expect(report).toHaveBeenCalledTimes(1);
  expect(vi.mocked(report).mock.calls[0]?.[1]).toEqual({ site: 'governance.loki' });
});

test('answers not-configured without a call when the url is unset', async () => {
  const fetchMock = respond(streams([]));
  vi.stubGlobal('fetch', fetchMock);

  expect(await lokiLogs({ url: undefined }, 'q', 1n, 2n, 5)).toEqual({ status: 'not-configured', entries: [] });
  expect(fetchMock).not.toHaveBeenCalled();
});
