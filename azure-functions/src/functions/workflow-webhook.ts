import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import * as df from 'durable-functions';
import { AzureSqlWorkflowStore } from '../../../packages/workflow/src/sql.js';
import { deliverWebhook } from '../../../packages/workflow/src/service.js';
import { ingressResponse } from '../../../packages/workflow/src/ingress-outcome.js';
import { withErrorBoundary } from '../../../packages/errors/src/boundary.js';
import { withFlush } from '../../../packages/telemetry/src/index.js';
import { durableScheduler } from './workflow-run.js';

export const workflowWebhook = withFlush(withErrorBoundary(async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
  const tenantId = request.params['tenantId']; const definitionId = request.params['definitionId'];
  const eventId = request.headers.get('x-workflow-event-id'); const timestamp = request.headers.get('x-workflow-timestamp'); const signature = request.headers.get('x-workflow-signature');
  const store = new AzureSqlWorkflowStore(process.env['AZURE_SQL_CONNECTION_STRING'] ?? '');
  const fallback = definitionId ? process.env[`WORKFLOW_WEBHOOK_SECRET_${definitionId.replaceAll('-', '').toUpperCase()}`] : undefined;
  const delivered = await deliverWebhook(store, durableScheduler(context), { tenantId, definitionId, eventId: eventId ?? undefined, timestamp: timestamp ?? undefined, signature: signature ?? undefined, body: new Uint8Array(await request.arrayBuffer()), headers: Object.fromEntries(request.headers.entries()), ...(fallback === undefined ? {} : { fallbackSecret: fallback }) });
  const reply = ingressResponse(delivered);
  return { status: reply.status, headers: { 'content-type': reply.contentType }, jsonBody: reply.body };
}));

app.http('workflowWebhook', { methods: ['POST'], authLevel: 'anonymous', route: 'workflow-webhook/{tenantId}/{definitionId}', extraInputs: [df.input.durableClient()], handler: workflowWebhook });
