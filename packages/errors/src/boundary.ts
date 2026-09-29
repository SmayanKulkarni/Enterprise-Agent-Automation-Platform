import type { NormalizedError } from '../../contracts/src/index.js';
import { report } from './report.js';

interface RequestLike { url: string; method: string; headers: { get(name: string): string | null } }
interface HttpResult { status: number; headers: Record<string, string>; jsonBody: unknown }
interface BoundaryOptions<Request> { headers?: (request: Request) => Record<string, string> | undefined }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BROWSER_ROUTE = /^\/(?:api\/)?v1\//u;
const TENANT_ROUTE = /\/(?:tenants|workflow-webhook|workflow-agent)\/([0-9a-f-]{36})(?:\/|$)/iu;

/** A caller-supplied id is kept only when it is a UUID; anything else would let clients forge log fields. */
export const correlationIdFrom = (value: string | null | undefined): string => value && UUID.test(value) ? value.toLowerCase() : crypto.randomUUID();

function failureBody(pathname: string, correlationId: string, error: NormalizedError): unknown {
  if (!BROWSER_ROUTE.test(pathname)) return { error };
  return { messageId: correlationId, contract: 'browser.v1', contractVersion: '1.0.0', occurredAt: new Date().toISOString(), sender: 'error-boundary', classification: 'restricted-operational', correlationId, payload: { error, completeness: 'not-ready' } };
}

export function withErrorBoundary<A extends [RequestLike, ...unknown[]], R>(handler: (...args: A) => Promise<R>, options: BoundaryOptions<A[0]> & { kind: 'fetch' }): (...args: A) => Promise<R | Response>;
export function withErrorBoundary<A extends [RequestLike, ...unknown[]], R>(handler: (...args: A) => Promise<R>, options?: BoundaryOptions<A[0]> & { kind?: 'azure' }): (...args: A) => Promise<R | HttpResult>;
export function withErrorBoundary<A extends [RequestLike, ...unknown[]], R>(handler: (...args: A) => Promise<R>, options: BoundaryOptions<A[0]> & { kind?: 'azure' | 'fetch' } = {}) {
  return async (...args: A): Promise<R | HttpResult | Response> => {
    try { return await handler(...args); } catch (error) {
      const [request] = args;
      const { pathname } = new URL(request.url);
      const correlationId = correlationIdFrom(request.headers.get('x-correlation-id'));
      const tenantId = TENANT_ROUTE.exec(pathname)?.[1];
      const app = report(error, { correlationId, method: request.method, route: pathname, ...(tenantId ? { tenantId } : {}) });
      const headers = { 'content-type': 'application/json', 'x-correlation-id': correlationId, ...options.headers?.(request) };
      const jsonBody = failureBody(pathname, correlationId, app.toBody());
      return options.kind === 'fetch' ? new Response(JSON.stringify(jsonBody), { status: app.status, headers }) : { status: app.status, headers, jsonBody };
    }
  };
}
