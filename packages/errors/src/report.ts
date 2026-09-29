import { trace } from '@opentelemetry/api';
import { classify, codeOf } from './classify.js';

export interface ErrorContext { correlationId?: string; tenantId?: string; method?: string; route?: string; site?: string }

const MAX_MESSAGE = 200;
const MAX_STACK = 4000;
const SECRET = /(?:Bearer\s+|(?:api[-_]?key|token|secret|password|pwd|authorization)[=:]\s*)[^\s;,'"]+/giu;
const scrub = (text: unknown, limit = MAX_MESSAGE): string => String(text).replace(SECRET, '[redacted]').slice(0, limit);

export function report(error: unknown, context: ErrorContext): ReturnType<typeof classify> {
  const app = classify(error);
  if (app.reported) return app;
  app.reported = true;

  const cause = app.cause instanceof Error ? app.cause : app;
  const isServerError = app.status >= 500;
  const correlationId = context.correlationId ?? crypto.randomUUID();
  const line = {
    correlationId, ...context, status: app.status, code: app.code, category: app.category,
    cause: { name: cause.name, ...(typeof codeOf(cause) === 'string' ? { code: codeOf(cause) } : {}), message: scrub(cause.message) },
    ...(isServerError && cause.stack ? { stack: scrub(cause.stack, MAX_STACK) } : {}),
  };
  (isServerError ? console.error : console.warn)(JSON.stringify(line));

  const span = trace.getActiveSpan();
  span?.setAttributes({ 'app.correlation_id': correlationId, 'app.error.code': app.code, 'app.error.status': app.status, ...(context.tenantId ? { 'app.tenant_id': context.tenantId } : {}) });
  span?.recordException({ name: cause.name, message: scrub(cause.message) });
  return app;
}
