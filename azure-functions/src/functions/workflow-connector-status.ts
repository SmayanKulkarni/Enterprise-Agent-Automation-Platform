import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { handleStatusMcp } from '../../../packages/workflow/src/commit-status-connector.js';
import { withErrorBoundary } from '../../../packages/errors/src/boundary.js';
import { withFlush } from '../../../packages/telemetry/src/index.js';

export const workflowConnectorStatus = withFlush(withErrorBoundary(async (request: HttpRequest): Promise<HttpResponseInit> => {
  const reply = await handleStatusMcp({ method: request.method, authorization: request.headers.get('authorization') ?? undefined, body: new Uint8Array(await request.arrayBuffer()) }, { targetBase: process.env['PLATFORM_BASE_URL'] });
  return { status: reply.status, jsonBody: reply.body };
}));

app.http('workflowConnectorStatus', { methods: ['POST'], authLevel: 'anonymous', route: 'connectors/github-status', handler: workflowConnectorStatus });
