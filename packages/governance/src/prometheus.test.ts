import type { PanelQuery } from './catalog.js';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('../../errors/src/report.js', () => ({ report: vi.fn() }));
const { report } = await import('../../errors/src/report.js');
const { prometheusRange } = await import('./prometheus.js');

const queries: PanelQuery[] = [{ label: 'p95', query: 'up' }];
const matrix = (result: unknown, resultType = 'matrix') => ({ status: 'success', data: { resultType, result } });
const respond = (body: unknown, status = 200) => vi.fn(() => Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })));
const run = (backend = { url: 'http://prom.invalid:9090' } as { url: string | undefined; user?: string; token?: string }, input = queries) => prometheusRange(backend, input, 1_000_000, 2_000_000, 300);

afterEach(() => { vi.unstubAllGlobals(); vi.mocked(report).mockClear(); });

test('maps a matrix response to millisecond points', async () => {
  vi.stubGlobal('fetch', respond(matrix([{ metric: {}, values: [[1700, '1.5'], [1760, '2']] }])));

  expect(await run()).toEqual({ status: 'ready', series: [{ label: 'p95', points: [[1_700_000, 1.5], [1_760_000, 2]] }] });
});

test('posts a form body with query, start, end and step', async () => {
  const fetchMock = respond(matrix([]));
  vi.stubGlobal('fetch', fetchMock);

  await run();

  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('http://prom.invalid:9090/api/v1/query_range');
  expect(init.method).toBe('POST');
  expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({ query: 'up', start: '1000', end: '2000', step: '300' });
});

test('drops NaN and infinite values', async () => {
  vi.stubGlobal('fetch', respond(matrix([{ metric: {}, values: [[1, 'NaN'], [2, '+Inf'], [3, '-Inf'], [4, '7']] }])));

  expect(await run()).toEqual({ status: 'ready', series: [{ label: 'p95', points: [[4000, 7]] }] });
});

test('labels many series from the by labels', async () => {
  vi.stubGlobal('fetch', respond(matrix([{ metric: { provider: 'azure' }, values: [[1, '1']] }, { metric: { provider: 'openrouter' }, values: [[1, '2']] }])));

  const result = await run(undefined, [{ label: 'p95', query: 'up', by: ['provider'] }]);

  expect(result.series.map((line) => line.label)).toEqual(['azure', 'openrouter']);
});

test('cuts 25 series to 20 and long series to 300 points', async () => {
  const values = Array.from({ length: 400 }, (_, index) => [index, '1']);
  vi.stubGlobal('fetch', respond(matrix(Array.from({ length: 25 }, (_, index) => ({ metric: { n: String(index) }, values })))));

  const result = await run(undefined, [{ label: 'x', query: 'up', by: ['n'] }]);

  expect(result.series).toHaveLength(20);
  expect(result.series[0]?.points).toHaveLength(300);
});

test.each([
  ['a 401', () => respond({}, 401)],
  ['a timeout', () => vi.fn(() => Promise.reject(new DOMException('t', 'TimeoutError')))],
  ['a vector result', () => respond(matrix([], 'vector'))],
  ['a non-JSON body', () => respond('<html>')],
  ['an error status', () => respond({ status: 'error' })],
])('answers unavailable with one report for %s', async (_name, make) => {
  vi.stubGlobal('fetch', make());

  expect(await run()).toEqual({ status: 'unavailable', series: [] });
  expect(report).toHaveBeenCalledTimes(1);
  expect(vi.mocked(report).mock.calls[0]?.[1]).toEqual({ site: 'governance.prometheus' });
});

test('answers not-configured without a network call when the url is unset', async () => {
  const fetchMock = respond(matrix([]));
  vi.stubGlobal('fetch', fetchMock);

  expect(await run({ url: undefined })).toEqual({ status: 'not-configured', series: [] });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('sets basic auth only when user and token both exist, and never leaks them', async () => {
  const fetchMock = respond(matrix([]));
  vi.stubGlobal('fetch', fetchMock);

  await run({ url: 'http://prom.invalid', user: 'u' });
  await run({ url: 'http://prom.invalid', user: 'u', token: 'secret' });

  const headers = fetchMock.mock.calls.map((call) => (call as unknown as [string, RequestInit])[1].headers as Record<string, string>);
  expect(headers[0]?.['authorization']).toBeUndefined();
  expect(headers[1]?.['authorization']).toBe(`Basic ${Buffer.from('u:secret').toString('base64')}`);
});

test('keeps credentials and the url out of a reported error', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('fetch failed', { cause: new Error('connect http://u:secret@prom.invalid') }))));

  await run({ url: 'http://prom.invalid', user: 'u', token: 'secret' });

  const reported = vi.mocked(report).mock.calls[0]?.[0] as Error;
  expect(JSON.stringify([reported.message, reported.cause])).not.toMatch(/secret|prom\.invalid/u);
});
