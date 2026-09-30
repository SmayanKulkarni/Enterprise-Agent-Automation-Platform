import { app, type InvocationContext, type Timer } from '@azure/functions';
import * as df from 'durable-functions';
import { AzureSqlWorkflowStore } from '../../../packages/workflow/src/sql.js';
import { recoverPendingWebhookDispatches } from '../../../packages/workflow/src/service.js';
import { report } from '../../../packages/errors/src/report.js';
import { count, withFlush } from '../../../packages/telemetry/src/index.js';
import { durableScheduler } from './workflow-run.js';

app.timer('workflowDispatchRecovery', { schedule: '0 */1 * * * *', extraInputs: [df.input.durableClient()], handler: withFlush(async (_timer: Timer, context: InvocationContext) => {
  try {
    const recovered = await recoverPendingWebhookDispatches(new AzureSqlWorkflowStore(process.env['AZURE_SQL_CONNECTION_STRING'] ?? ''), durableScheduler(context));
    if (recovered > 0) count('workflow.dispatch.recovered', {}, recovered);
  } catch (error) { report(error, { site: 'workflowDispatchRecovery' }); throw error; }
}) });
