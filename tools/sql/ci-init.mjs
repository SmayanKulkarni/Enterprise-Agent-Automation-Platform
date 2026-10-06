import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sql from 'mssql';

const server = process.env['CI_SQL_SERVER'] ?? 'sql';
const saPassword = process.env['MSSQL_SA_PASSWORD'];
if (!saPassword) throw new Error('Missing MSSQL_SA_PASSWORD.');

const connection = (database) => `Server=${server};Database=${database};User Id=sa;Password=${saPassword};Encrypt=true;TrustServerCertificate=true;Connect Timeout=60`;
const sqlTool = (action, extra = {}) => execFileSync('node', ['tools/sql/azure-sql.mjs', action], { stdio: 'inherit', env: { ...process.env, AZURE_SQL_CONNECTION_STRING: connection('platform'), ...extra } });

const master = await new sql.ConnectionPool(connection('master')).connect();
try {
  await master.request().batch(`EXEC sp_configure 'contained database authentication', 1; RECONFIGURE;
    IF DB_ID(N'platform') IS NULL CREATE DATABASE platform CONTAINMENT = PARTIAL;`);
} finally {
  await master.close();
}

sqlTool('migrate');
sqlTool('migrate');
sqlTool('verify');
sqlTool('seed', { AZURE_SQL_ALLOW_DEMO_SEED: 'true' });

const runtimePassword = `Aa1!${randomBytes(18).toString('hex')}`;
const bootstrap = (await readFile('database/bootstrap/create-platform-identity-user.sql', 'utf8')).replace('REPLACE_WITH_A_NEW_PASSWORD', runtimePassword);
const platform = await new sql.ConnectionPool(connection('platform')).connect();
try {
  await platform.request().batch(bootstrap);
} finally {
  await platform.close();
}

const runtime = await new sql.ConnectionPool(`Server=${server};Database=platform;User Id=platform_identity_app;Password=${runtimePassword};Encrypt=true;TrustServerCertificate=true;Connect Timeout=60`).connect();
try {
  const { recordset } = await runtime.request().query("SELECT COUNT(*) AS roles FROM sys.database_principals WHERE name LIKE N'platform[_]%' AND type = N'R' AND IS_ROLEMEMBER(name) = 1");
  if (recordset[0].roles !== 7) throw new Error(`Contained user holds ${recordset[0].roles} of 7 platform roles.`);
  console.log('Runtime contained user connects and holds all 7 platform roles.');
} finally {
  await runtime.close();
}
