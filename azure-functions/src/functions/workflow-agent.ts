import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { createHash, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from '../../../packages/contracts/src/index.js';
import { AzureSqlWorkflowStore } from '../../../packages/workflow/src/sql.js';
import type { EffectData } from '../../../packages/workflow/src/runtime.js';
import type { Installation } from '../../../packages/workflow/src/service.js';
import { durableScheduler } from './workflow-run.js';
import * as df from 'durable-functions';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function workflowAgent(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const tenantId = request.params['tenantId']; const installationId = request.params['installationId']; const operation = request.params['operation'];
  if (!uuid.test(tenantId ?? '') || !uuid.test(installationId ?? '') || !['poll', 'result'].includes(operation ?? '')) return { status: 404 };
  const token = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{40,})$/u)?.[1];
  if (!token) return { status: 403 };
  const store = new AzureSqlWorkflowStore(process.env['AZURE_SQL_CONNECTION_STRING'] ?? '');
  try {
    const record = await store.workerRead<Installation>(tenantId!, 'installation', installationId!);
    const expected = record?.data.tokenHash;
    if (!record || record.data.route !== 'private' || record.state === 'revoked' || !expected || !timingSafeEqual(Buffer.from(expected, 'hex'), createHash('sha256').update(token).digest())) return { status: 403 };
    if (request.method === 'GET' && operation === 'poll') {
      if (record.state === 'offline') await store.workerWrite(tenantId!, 'installation', installationId!, record.version, 'healthy', { ...record.data, health: 'healthy' });
      const queued = (await store.workerList<EffectData>(tenantId!, 'effect')).find((item) => item.state === 'queued' && item.data.installationId === installationId);
      if (!queued) return { status: 204 };
      const claim = await store.workerWrite(tenantId!, 'effect', queued.id, queued.version, 'possible-send', { ...queued.data, state: 'possible-send' });
      return { status: 200, jsonBody: { effectId: claim.id, capability: claim.data.output?.['capability'], arguments: claim.data.output?.['args'], deadline: claim.data.output?.['deadline'] } };
    }
    if (request.method === 'POST' && operation === 'result') {
      const value: unknown = await request.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 400 };
      const body = value as Record<string, unknown>; const effectId = body['effectId'];
      if (typeof effectId !== 'string' || !uuid.test(effectId) || !['succeeded', 'failed', 'unknown-outcome'].includes(String(body['outcome']))) return { status: 400 };
      const effect = await store.workerRead<EffectData>(tenantId!, 'effect', effectId);
      if (!effect || effect.data.installationId !== installationId) return { status: 409 };
      const outcome = body['outcome'] as EffectData['state']; const output = body['output'];
      if (outcome === 'succeeded' && (output === null || typeof output !== 'object' || Array.isArray(output))) return { status: 400 };
      if (effect.state !== 'possible-send' && (effect.state !== outcome || outcome === 'succeeded' && canonicalJson(effect.data.output) !== canonicalJson(output))) return { status: 409 };
      if (effect.state === 'possible-send') await store.workerWrite(tenantId!, 'effect', effectId, effect.version, outcome, { ...effect.data, state: outcome, ...(outcome === 'succeeded' ? { output: output as Record<string, unknown> } : {}) });
      await durableScheduler(context).raise(effect.data.runId, 'connector', { effectId, outcome });
      return { status: 200, jsonBody: { accepted: true } };
    }
    return { status: 405 };
  } catch { return { status: 503 }; }
}

app.http('workflowAgent', { methods: ['GET', 'POST'], authLevel: 'anonymous', route: 'workflow-agent/{tenantId}/{installationId}/{operation}', extraInputs: [df.input.durableClient()], handler: workflowAgent });
