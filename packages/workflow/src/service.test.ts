import { expect, test } from 'vitest';
import { decodeProjection } from '../../browser/src/browser-contracts.js';
import { tenantId } from '../../contracts/src/index.js';
import { WorkflowService } from './service.js';

const tenant = '11111111-1111-4111-8111-111111111111';

test('projects OpenRouter models with a browser-contract record ID', async () => {
  const service = new WorkflowService(undefined as never, undefined as never);
  const projection = await service.projection({ mode: 'interactive', userId: 'user-1', tenantId: tenantId(tenant), expiresAt: '2099-01-01T00:00:00.000Z', membershipEpoch: 1, tenantEpoch: 1, sessionId: 'session-1' }, 'openrouter-models');

  expect(() => decodeProjection(projection, tenant, 'openrouter-models')).not.toThrow();
});
