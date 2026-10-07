import { app, type Timer } from '@azure/functions';
import { AzureSqlDemoStore } from '../../../packages/browser/src/demo-store.js';
import { report } from '../../../packages/errors/src/report.js';
import { withFlush } from '../../../packages/telemetry/src/index.js';

app.timer('demoPurge', { schedule: '0 30 4 * * *', handler: withFlush(async (_timer: Timer) => {
  const connectionString = process.env['AZURE_SQL_CONNECTION_STRING']?.trim();
  if (!connectionString) return;
  try { await new AzureSqlDemoStore(connectionString).purge(); } catch (error) { report(error, { site: 'demoPurge' }); throw error; }
}) });
