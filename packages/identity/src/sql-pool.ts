import sql from 'mssql';

const pools = new Map<string, Promise<sql.ConnectionPool>>();

export function sqlPool(connectionString: string): Promise<sql.ConnectionPool> {
  const existing = pools.get(connectionString);
  if (existing !== undefined) return existing;

  const pool = new sql.ConnectionPool(connectionString);
  const connecting = pool.connect().catch(async (error: unknown) => {
    if (pools.get(connectionString) === connecting) pools.delete(connectionString);
    await pool.close().catch(() => undefined);
    throw error;
  });
  pool.on('error', () => { if (pools.get(connectionString) === connecting) pools.delete(connectionString); });
  pools.set(connectionString, connecting);
  return connecting;
}
