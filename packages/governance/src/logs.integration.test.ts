import { randomUUID } from 'node:crypto';
import { trace } from '@opentelemetry/api';
import { expect, test } from 'vitest';
import { backends, eventually, reachable } from './integration.test-support.js';
import { GovernanceService } from './service.js';
import { flushTelemetry, logEvent, startTelemetry } from '../../telemetry/src/index.js';

const available = await reachable(backends.loki.url, '/ready') && await reachable(backends.tempo.url, '/ready');
const tenantId = randomUUID();
const runId = randomUUID();
const context = { userId: randomUUID(), groupId: randomUUID(), groupEpoch: 1, adminEpoch: 1, tenantIds: [tenantId] as never };

test.skipIf(!available)('reads an emitted event and span back through the service', async () => {
  startTelemetry('governance-integration');
  logEvent('run.started', { tenant_id: tenantId, run_id: runId, definition_id: randomUUID(), trigger: 'manual' });
  trace.getTracer('governance-integration').startActiveSpan('workflow.step', { attributes: { tenant_id: tenantId, 'workflow.run_id': runId, 'workflow.node_id': 'n1' } }, (span) => { span.end(); });
  await flushTelemetry();
  const service = new GovernanceService(undefined, Date.now, backends);

  const logs = await eventually(() => service.read(context, 'logs', { range: '1h', run: runId }), (value) => (value['entries'] as unknown[]).length > 0);
  const spans = await eventually(() => service.read(context, 'trace', { run: runId }), (value) => (value['spans'] as unknown[]).length > 0);

  expect(logs['entries']).toEqual([expect.objectContaining({ event: 'run.started', attributes: expect.objectContaining({ run_id: runId, tenant_id: tenantId }) as unknown })]);
  expect(spans['spans']).toEqual([expect.objectContaining({ name: 'workflow.step', attributes: expect.objectContaining({ 'workflow.run_id': runId }) as unknown })]);
}, 120_000);
