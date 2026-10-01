import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { PROMETHEUS_PANELS, type PrometheusPanelId } from './catalog.js';
import { backends, eventually, reachable, sleep } from './integration.test-support.js';
import { GovernanceService } from './service.js';
import { count, flushTelemetry, record, startTelemetry } from '../../telemetry/src/index.js';

const available = await reachable(backends.prometheus.url, '/-/ready');
const tenantId = randomUUID();
const context = { userId: randomUUID(), groupId: randomUUID(), groupEpoch: 1, adminEpoch: 1, tenantIds: [tenantId] as never };
const REPEATS = 2;
const GAP_MS = 3000;

function emit(): void {
  const gen = { tenant_id: tenantId, 'gen_ai.provider.name': 'azure-openai', 'gen_ai.request.model': 'gpt-test', feature: 'workflow' };
  record('http.server.request.duration', 0.2, { tenant_id: tenantId, 'http.route': '/x', 'http.request.method': 'GET', 'http.response.status_code': 200 });
  record('http.server.request.duration', 0.4, { tenant_id: tenantId, 'http.route': '/x', 'http.request.method': 'GET', 'http.response.status_code': 500 });
  record('gen_ai.client.operation.duration', 1.2, { ...gen, 'error.type': 'timeout' });
  record('gen_ai.client.token.usage', 120, { ...gen, 'gen_ai.token.type': 'input' });
  record('mcp.tool.call.duration', 0.3, { tenant_id: tenantId, capability: 'c', outcome: 'succeeded', route: 'public' });
  record('workflow.approval.wait.duration', 12, { tenant_id: tenantId, decision: 'approve' });
  count('workflow.circuit.transitions', { tenant_id: tenantId, kind: 'model', state: 'open' });
}

describe.skipIf(!available)('prometheus panels against the local stack', () => {
  test.each(Object.keys(PROMETHEUS_PANELS) as PrometheusPanelId[])('%s answers ready with at least one point', async (panel) => {
    startTelemetry('governance-integration');
    for (let index = 0; index < REPEATS; index += 1) { emit(); await flushTelemetry(); await sleep(GAP_MS); }
    const service = new GovernanceService(undefined, Date.now, backends);

    const result = await eventually(() => service.read(context, 'series', { range: '24h', panel }), (value) => (value['series'] as unknown[]).length > 0);

    expect(result['status']).toBe('ready');
    expect((result['series'] as { points: unknown[] }[]).flatMap((line) => line.points).length).toBeGreaterThan(0);
  }, 60_000);
});
