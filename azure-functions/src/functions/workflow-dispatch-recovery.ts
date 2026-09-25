import { app, type InvocationContext, type Timer } from '@azure/functions';
import { AzureSqlWorkflowStore } from '../../../packages/workflow/src/sql.js';
import { recoverPendingWebhookDispatches } from '../../../packages/workflow/src/service.js';
import { durableScheduler } from './workflow-run.js';

app.timer('workflowDispatchRecovery', { schedule: '0 */1 * * * *', handler: async (_timer: Timer, context: InvocationContext) => {
  await recoverPendingWebhookDispatches(new AzureSqlWorkflowStore(process.env['AZURE_SQL_CONNECTION_STRING'] ?? ''), durableScheduler(context));
} });
