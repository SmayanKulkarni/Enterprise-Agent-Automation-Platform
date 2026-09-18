import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sql from 'mssql';

const workdir = process.cwd();
const actionName = process.argv[2];
if (actionName !== 'migrate' && actionName !== 'verify' && actionName !== 'seed' && actionName !== 'status') throw new Error('Use sql:migrate, sql:verify, sql:status, or sql:seed.');
const connectionString = process.env['AZURE_SQL_CONNECTION_STRING'];

if (!connectionString) throw new Error('Missing AZURE_SQL_CONNECTION_STRING.');
if (actionName === 'seed' && process.env['AZURE_SQL_ALLOW_DEMO_SEED'] !== 'true') throw new Error('Set AZURE_SQL_ALLOW_DEMO_SEED=true to seed demo data.');

if (actionName === 'status') {
  const pool = await new sql.ConnectionPool(connectionString).connect();
  try {
    const result = await pool.request().query(`
      SELECT DB_NAME() AS database_name, @@SERVERNAME AS server_name, SYSDATETIMEOFFSET() AS checked_at;
      SELECT OBJECT_SCHEMA_NAME(object_id) AS schema_name, OBJECT_NAME(object_id) AS table_name, SUM(rows) AS row_count
      FROM sys.partitions
      WHERE index_id IN (0, 1) AND OBJECT_SCHEMA_NAME(object_id) IN (N'identity', N'projection')
      GROUP BY object_id
      ORDER BY table_name;
      IF OBJECT_ID(N'dbo.platform_schema_migrations', N'U') IS NULL
        SELECT CAST(NULL AS nvarchar(255)) AS id, CAST(NULL AS datetime2(7)) AS applied_at WHERE 1 = 0;
      ELSE
        SELECT id, applied_at FROM dbo.platform_schema_migrations ORDER BY applied_at;
    `);
    const recordsets = result.recordsets;
    if (!Array.isArray(recordsets)) throw new Error('SQL status response was invalid.');
    console.log(JSON.stringify({ connection: recordsets[0], tables: recordsets[1], migrations: recordsets[2] }, null, 2));
  } finally {
    await pool.close();
  }
  process.exit(0);
}

const folder = actionName === 'migrate' ? 'migrations' : actionName === 'verify' ? 'verify' : 'seed';
const files = (await readdir(resolve(workdir, 'database', folder))).filter((file) => /^\d{3}_[a-z0-9_]+\.sql$/u.test(file)).sort();
if (files.length === 0) throw new Error(`No SQL files found in database/${folder}.`);

const pool = await new sql.ConnectionPool(connectionString).connect();
try {
  if (actionName === 'migrate') {
    await pool.request().batch(`IF OBJECT_ID(N'dbo.platform_schema_migrations', N'U') IS NULL
      CREATE TABLE dbo.platform_schema_migrations (
        id nvarchar(255) NOT NULL CONSTRAINT PK_platform_schema_migrations PRIMARY KEY,
        digest char(64) NOT NULL,
        applied_at datetime2(7) NOT NULL CONSTRAINT DF_platform_schema_migrations_applied_at DEFAULT (SYSUTCDATETIME())
      );`);
  }
  for (const file of files) {
    const source = await readFile(resolve(workdir, 'database', folder, file), 'utf8');
    const id = file.replace(/\.sql$/u, '');
    if (actionName !== 'migrate') { await pool.request().batch(source); console.log(`Passed ${id}.`); continue; }
    const checksum = createHash('sha256').update(source).digest('hex');
    const prior = await pool.request().input('id', sql.NVarChar(255), id).query('SELECT digest FROM dbo.platform_schema_migrations WHERE id = @id;');
    const recorded = prior.recordset[0]?.digest;
    if (recorded !== undefined && recorded !== checksum) throw new Error(`Migration ${id} differs from the applied digest.`);
    if (recorded === undefined) {
      await pool.request().batch(source);
      await pool.request().input('id', sql.NVarChar(255), id).input('digest', sql.Char(64), checksum).query('INSERT INTO dbo.platform_schema_migrations (id, digest) VALUES (@id, @digest);');
      console.log(`Applied ${id}.`);
    } else console.log(`${id} is already applied.`);
  }
} finally {
  await pool.close();
}
