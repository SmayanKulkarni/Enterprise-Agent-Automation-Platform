import { trace } from '@opentelemetry/api';
import { logEvent } from '../../telemetry/src/events.js';
import { count } from '../../telemetry/src/instruments.js';
import { classify, codeOf } from './classify.js';
import { scrub } from './scrub.js';

export interface ErrorContext { correlationId?: string; tenantId?: string; tenantVerified?: boolean; method?: string; route?: string; site?: string }

const MAX_STACK = 4000;

export function report(error: unknown, context: ErrorContext): ReturnType<typeof classify> {
  const app = classify(error);
  if (app.reported) return app;
  app.reported = true;

  const cause = app.cause instanceof Error ? app.cause : app;
  const isServerError = app.status >= 500;
  const correlationId = context.correlationId ?? crypto.randomUUID();
  const { tenantVerified, ...loggable } = context;
  const line = {
    correlationId, ...loggable, status: app.status, code: app.code, category: app.category,
    cause: { name: cause.name, ...(typeof codeOf(cause) === 'string' ? { code: codeOf(cause) } : {}), message: scrub(cause.message) },
    ...(isServerError && cause.stack ? { stack: scrub(cause.stack, MAX_STACK) } : {}),
  };
  (isServerError ? console.error : console.warn)(JSON.stringify(line));

  const span = trace.getActiveSpan();
  span?.setAttributes({ 'app.correlation_id': correlationId, 'app.error.code': app.code, 'app.error.status': app.status, ...(context.tenantId ? { 'app.tenant_id': context.tenantId } : {}) });
  span?.recordException({ name: cause.name, message: scrub(cause.message) });

  logEvent('api.request.failed', { tenant_id: context.tenantId, route: context.route, method: context.method, status: app.status, code: app.code, category: app.category, correlation_id: correlationId }, isServerError ? 'error' : 'warn');
  const trustedTenant = context.site !== undefined || tenantVerified === true;
  count('app.errors', { code: app.code, category: app.category, site: context.site, tenant_id: trustedTenant ? context.tenantId : undefined });
  return app;
}
