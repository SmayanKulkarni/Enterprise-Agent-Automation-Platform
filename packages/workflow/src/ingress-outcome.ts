import type { WebhookDelivery } from './service.js';

export interface IngressResponse { status: number; contentType: 'application/json' | 'application/problem+json'; body: Record<string, unknown>; }

const problem = (status: number, title: string): IngressResponse => ({ status, contentType: 'application/problem+json', body: { type: 'about:blank', title, status } });

export function ingressResponse(delivery: WebhookDelivery | undefined): IngressResponse {
  if (delivery === undefined) return problem(500, 'Webhook delivery failed');
  switch (delivery.outcome) {
    case 'accepted':
    case 'replay': return { status: 202, contentType: 'application/json', body: { runId: delivery.runId, status: 'queued' } };
    case 'ignored': return { status: 202, contentType: 'application/json', body: { status: 'ignored' } };
    case 'too-large': return problem(413, 'Request body is too large');
    case 'conflict': return problem(422, 'Event id reused with a different payload');
    case 'not-found': return problem(404, 'Workflow not found');
    case 'invalid-shape': return problem(400, 'Request does not match the workflow input');
    default: return problem(403, 'Delivery was not authorised');
  }
}
