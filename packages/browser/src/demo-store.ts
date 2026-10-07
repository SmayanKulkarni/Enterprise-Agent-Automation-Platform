import { createHash } from 'node:crypto';
import sql from 'mssql';
import { canonicalJson } from '../../contracts/src/index.js';
import { sqlPool } from '../../identity/src/sql-pool.js';
import { demoGraph, type DemoRun } from '../../workflow/src/pr-gate-demo.js';

export const DEMO_RETENTION_DAYS = 30;

export class AzureSqlDemoStore {
  constructor(private readonly connectionString: string) {}
  async write(key: string, run: DemoRun): Promise<void> {
    const graph = canonicalJson(demoGraph());
    const request = (await sqlPool(this.connectionString)).request();
    await request
      .input('id', sql.UniqueIdentifier, run.id)
      .input('digest', sql.Char(64), createHash('sha256').update(graph).digest('hex'))
      .input('graph_json', sql.NVarChar(sql.MAX), graph)
      .input('claim_key', sql.Char(32), key)
      .input('source', sql.NVarChar(16), run.source)
      .input('branch', sql.NVarChar(16), run.branch)
      .input('started_at', sql.DateTime2(7), new Date(run.startedAt))
      .input('run_json', sql.NVarChar(sql.MAX), JSON.stringify(run))
      .execute('public_demo.write_run');
  }
  async purge(): Promise<number> {
    const result = await (await sqlPool(this.connectionString)).request().input('retention_days', sql.Int, DEMO_RETENTION_DAYS).execute('public_demo.purge_runs');
    return Number((result.recordset[0] as { removed?: unknown } | undefined)?.removed ?? 0);
  }
}
