import { afterEach, expect, test, vi } from 'vitest';

vi.mock('../../errors/src/report.js', () => ({ report: vi.fn() }));
const { report } = await import('../../errors/src/report.js');
const { tempoTrace } = await import('./tempo.js');

const tenant = '11111111-1111-4111-8111-111111111111';
const foreign = '99999999-9999-4999-8999-999999999999';
const run = '33333333-3333-4333-8333-333333333333';
const text = (key: string, value: string) => ({ key, value: { stringValue: value } });
const span = (id: string, startNs: string, endNs: string, attributes: unknown[] = [text('tenant_id', tenant)], extra: object = {}) => ({ traceId: 'a'.repeat(32), spanId: id.padStart(16, '0'), name: `span-${id}`, startTimeUnixNano: startNs, endTimeUnixNano: endNs, status: { code: 1 }, attributes, ...extra });
const trace = (spans: unknown[], key = 'batches') => ({ [key]: [{ scopeSpans: [{ spans }] }] });
const backend = { url: 'http://tempo.invalid' };

const stub = (search: unknown, traces: unknown, status = 200) => vi.stubGlobal('fetch', vi.fn((input: string) => Promise.resolve(new Response(JSON.stringify(input.includes('/api/search') ? search : traces), { status }))));

afterEach(() => { vi.unstubAllGlobals(); vi.mocked(report).mockClear(); });

test('returns spans in start order with millisecond values', async () => {
  stub({ traces: [{ traceID: 'a'.repeat(32) }] }, trace([span('2', '1700000000500000000', '1700000001000000000'), span('1', '1700000000000000000', '1700000000250000000', [text('tenant_id', tenant), text('node_kind', 'model')], { parentSpanId: '9'.padStart(16, '0') })]));

  const result = await tempoTrace(backend, run, tenant, [tenant]);

  expect(result.status).toBe('ready');
  expect(result.spans.map((s) => [s.name, s.startMs, s.durationMs, s.status])).toEqual([['span-1', 1_700_000_000_000, 250, 'ok'], ['span-2', 1_700_000_000_500, 500, 'ok']]);
  expect(result.spans[0]).toMatchObject({ traceId: 'a'.repeat(32), spanId: '0000000000000001', parentSpanId: '0000000000000009', attributes: { tenant_id: tenant, node_kind: 'model' } });
});

test('drops attributes outside the allowlist', async () => {
  stub({ traces: [{ traceID: 'a'.repeat(32) }] }, trace([span('1', '1', '2', [text('tenant_id', tenant), text('db.query.text', 'select secret'), text('url.full', 'https://x')])]));

  expect((await tempoTrace(backend, run, tenant, [tenant])).spans[0]?.attributes).toEqual({ tenant_id: tenant });
});

test('drops a span from a tenant outside the group', async () => {
  stub({ traces: [{ traceID: 'a'.repeat(32) }] }, trace([span('1', '1', '2'), span('2', '1', '2', [text('tenant_id', foreign)])]));

  expect((await tempoTrace(backend, run, tenant, [tenant])).spans.map((s) => s.name)).toEqual(['span-1']);
});

test('cuts 600 spans to 500', async () => {
  stub({ traces: [{ traceID: 'a'.repeat(32) }] }, trace(Array.from({ length: 600 }, (_, index) => span(String(index + 1), String(index + 1), String(index + 2)))));

  expect((await tempoTrace(backend, run, tenant, [tenant])).spans).toHaveLength(500);
});

test('accepts resourceSpans and base64 ids, and maps error status', async () => {
  stub({ traces: [{ traceID: 'a'.repeat(32) }] }, trace([span('1', '1', '2', [text('tenant_id', tenant)], { traceId: Buffer.alloc(16, 1).toString('base64'), spanId: Buffer.alloc(8, 2).toString('base64'), status: { code: 'STATUS_CODE_ERROR' } })], 'resourceSpans'));

  expect((await tempoTrace(backend, run, tenant, [tenant])).spans[0]).toMatchObject({ traceId: '01'.repeat(16), spanId: '02'.repeat(8), status: 'error' });
});

test('a search with no traces is ready and empty', async () => {
  stub({ traces: [] }, {});

  expect(await tempoTrace(backend, run, tenant, [tenant])).toEqual({ status: 'ready', spans: [] });
});

test('sends a TraceQL query with the run id and tenant pattern', async () => {
  stub({ traces: [] }, {});

  await tempoTrace(backend, run, tenant, [tenant]);

  const url = new URL((vi.mocked(fetch).mock.calls[0] as unknown as [string])[0]);
  expect(url.searchParams.get('q')).toBe(`{ span.workflow.run_id = "${run}" && span.tenant_id =~ "${tenant}" }`);
  expect(url.searchParams.get('limit')).toBe('20');
});

test('answers unavailable with one report on a failure or an unexpected shape', async () => {
  stub({ nope: true }, {});

  expect(await tempoTrace(backend, run, tenant, [tenant])).toEqual({ status: 'unavailable', spans: [] });
  expect(report).toHaveBeenCalledTimes(1);
  expect(vi.mocked(report).mock.calls[0]?.[1]).toEqual({ site: 'governance.tempo' });
});

test('answers not-configured without a call when the url is unset', async () => {
  stub({ traces: [] }, {});

  expect(await tempoTrace({ url: undefined }, run, tenant, [tenant])).toEqual({ status: 'not-configured', spans: [] });
  expect(fetch).not.toHaveBeenCalled();
});
