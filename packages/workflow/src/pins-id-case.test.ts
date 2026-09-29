import { expect, test } from 'vitest';
import { tenantId } from '../../contracts/src/index.js';
import { WorkflowService } from './service.js';
import type { WorkflowStore } from './sql.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const installationId = '44444444-4444-4444-8444-44444444abcd';
const draftId = '55555555-5555-4555-8555-55555555abcd';
const schema = { type: 'object', properties: {}, required: [], additionalProperties: false };
const installation = { id: installationId.toUpperCase(), kind: 'installation', version: 1, state: 'healthy', data: { route: 'public', endpoint: 'https://localhost:8443/mcp', health: 'healthy', manifest: { version: '1', certified: true, digest: 'd'.repeat(64), capabilities: [{ name: 'draw', risk: 'R1', inputSchema: schema, outputSchema: schema }] } } };
const grant = { id: '66666666-6666-4666-8666-666666666666', kind: 'grant', version: 1, state: 'active', data: { draftId, nodeId: 'mcp', installationId, capability: 'draw', manifestDigest: 'd'.repeat(64) } };
const store = { list: async (_context: unknown, kind: string) => kind === 'grant' ? [grant] : [installation] } as unknown as WorkflowStore;
const context = { mode: 'interactive', userId: 'user-1', tenantId: tenantId(tenant), expiresAt: '2099-01-01T00:00:00.000Z', membershipEpoch: 1, tenantEpoch: 1, sessionId: 'session-1' } as never;

test('a grant pins its capability when the store returns the installation id in another letter case', async () => {
  const service = new WorkflowService(undefined as never, store);
  const pins = await service.pins(context, draftId.toUpperCase());
  expect(pins).toHaveLength(1);
  expect(pins[0]).toMatchObject({ nodeId: 'mcp', capability: 'draw', risk: 'R1' });
});
