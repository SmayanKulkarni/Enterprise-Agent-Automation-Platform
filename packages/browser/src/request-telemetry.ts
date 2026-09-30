import { SpanStatusCode, trace } from '@opentelemetry/api';
import { logEvent } from '../../telemetry/src/events.js';
import { count, record } from '../../telemetry/src/instruments.js';

export const ROUTES = {
  session: '/api/v1/session',
  tenants: '/api/v1/tenants',
  tenantCollection: '/api/v1/tenants/:tenantId/:collection',
  tenantCommand: '/api/v1/tenants/:tenantId/commands/:owner/:name',
  tenantConnection: '/api/v1/tenants/:tenantId/openrouter-connection',
  tenantEvents: '/api/v1/tenants/:tenantId/events',
  groups: '/api/v1/groups',
  groupCollection: '/api/v1/groups/:groupId/:collection',
  groupCommand: '/api/v1/groups/:groupId/commands/governance/:name',
  groupCreate: '/api/v1/groups/commands/governance/create-group',
  groupAssistant: '/api/v1/groups/:groupId/assistant',
  unmatched: 'unmatched',
} as const;

export type Route = (typeof ROUTES)[keyof typeof ROUTES];
export interface RequestState { route: Route; tenantId?: string; code?: string }

const TRACER_NAME = 'threadline.browser-api';
const MILLISECONDS_PER_SECOND = 1000;
const SERVER_ERROR = 500;
const DENIED_STATUSES: ReadonlySet<number> = new Set([401, 403]);

export function observeRequest<Response extends { status: number }>(method: string, correlationId: string, state: RequestState, run: () => Promise<Response>): Promise<Response> {
  const startedAt = performance.now();
  return trace.getTracer(TRACER_NAME).startActiveSpan('browser.request', { attributes: { 'http.request.method': method, 'app.correlation_id': correlationId } }, async (span) => {
    let status = SERVER_ERROR;
    try {
      const response = await run();
      status = response.status;
      return response;
    } finally {
      const labels = { 'http.route': state.route, 'http.request.method': method, 'http.response.status_code': status, tenant_id: state.tenantId };
      record('http.server.request.duration', (performance.now() - startedAt) / MILLISECONDS_PER_SECOND, labels);
      span.setAttributes({ 'http.route': state.route, 'http.response.status_code': status, ...(state.tenantId === undefined ? {} : { tenant_id: state.tenantId }) });
      if (status >= SERVER_ERROR) span.setStatus({ code: SpanStatusCode.ERROR });
      if (DENIED_STATUSES.has(status)) { count('auth.denied', { reason: state.code }); logEvent('auth.denied', { route: state.route, reason: state.code }); }
      span.end();
    }
  });
}
