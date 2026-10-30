import pg from 'pg';

// Keep DATE columns as plain 'YYYY-MM-DD' strings (never shifted through the server timezone)
// and return bigint/count values as numbers (all ids and counts stay far below 2^53).
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(20, (v: string) => Number(v));

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
export type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

export function createPool(connectionString: string, max = 10): Pool {
  return new pg.Pool({ connectionString, max });
}

/** Runs `fn` in a single transaction; rolls back on any thrown error. */
export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
    throw err;
  } finally {
    client.release();
  }
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
