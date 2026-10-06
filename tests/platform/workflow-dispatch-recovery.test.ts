import { expect, test, vi } from 'vitest';

const timer = vi.hoisted(() => vi.fn());

vi.mock('@azure/functions', () => ({ app: { timer } }));
vi.mock('durable-functions', () => ({ input: { durableClient: () => ({}) } }));
vi.mock('../../azure-functions/src/functions/workflow-run.js', () => ({ durableScheduler: vi.fn() }));
vi.mock('../../packages/workflow/src/sql.js', () => ({ AzureSqlWorkflowStore: vi.fn() }));
vi.mock('../../packages/workflow/src/service.js', () => ({ recoverPendingWebhookDispatches: vi.fn() }));
vi.mock('../../packages/errors/src/report.js', () => ({ report: vi.fn() }));
vi.mock('../../packages/telemetry/src/index.js', () => ({ count: vi.fn(), withFlush: (handler: unknown) => handler }));

test('reads the recovery schedule from the app setting binding', async () => {
  await import('../../azure-functions/src/functions/workflow-dispatch-recovery.js');
  expect(timer).toHaveBeenCalledWith('workflowDispatchRecovery', expect.objectContaining({ schedule: '%WORKFLOW_DISPATCH_RECOVERY_SCHEDULE%' }));
});
