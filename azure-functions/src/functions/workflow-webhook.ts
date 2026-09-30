import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import * as df from 'durable-functions';
import { AzureSqlWorkflowStore } from '../../../packages/workflow/src/sql.js';
import { deliverWebhook } from '../../../packages/workflow/src/service.js';
import { AppError } from '../../../packages/errors/src/app-error.js';
import { withErrorBoundary } from '../../../packages/errors/src/boundary.js';
import { withFlush } from '../../../packages/telemetry/src/index.js';
import { durableScheduler } from './workflow-run.js';

export const workflowWebhook = withFlush(withErrorBoundary(async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
  const tenantId = request.params['tenantId']; const definitionId = request.params['definitionId'];
  const eventId = request.headers.get('x-workflow-event-id'); const timestamp = request.headers.get('x-workflow-timestamp'); const signature = request.headers.get('x-workflow-signature');
  const store = new AzureSqlWorkflowStore(process.env['AZURE_SQL_CONNECTION_STRING'] ?? '');
  const fallback = definitionId ? process.env[`WORKFLOW_WEBHOOK_SECRET_${definitionId.replaceAll('-', '').toUpperCase()}`] : undefined;
  const delivered = await deliverWebhook(store, durableScheduler(context), { tenantId, definitionId, eventId: eventId ?? undefined, timestamp: timestamp ?? undefined, signature: signature ?? undefined, body: new Uint8Array(await request.arrayBuffer()), ...(fallback === undefined ? {} : { fallbackSecret: fallback }) });
  if (delivered.outcome === 'accepted') return { status: 202, jsonBody: { runId: delivered.runId, status: 'queued' } };
  if (delivered.outcome === 'replay') return { status: 202, ...(delivered.runId ? { jsonBody: { runId: delivered.runId, status: 'queued' } } : {}) };
  if (delivered.outcome === 'not-found') throw new AppError('NOT_FOUND');
  throw new AppError(delivered.outcome === 'invalid-shape' ? 'INVALID' : 'DENIED');
}));

app.http('workflowWebhook', { methods: ['POST'], authLevel: 'anonymous', route: 'workflow-webhook/{tenantId}/{definitionId}', extraInputs: [df.input.durableClient()], handler: workflowWebhook });
