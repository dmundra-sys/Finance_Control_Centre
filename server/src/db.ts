import pg from 'pg';
import { config } from './config.js';

// numeric -> number, int8 -> number, date -> 'YYYY-MM-DD' string (avoid timezone shifts)
pg.types.setTypeParser(1700, (v) => parseFloat(v));
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });
export type Db = pg.Pool | pg.PoolClient;

export async function query<T = any>(sql: string, params: any[] = [], db: Db = pool): Promise<T[]> {
  const r = await db.query(sql, params);
  return r.rows as T[];
}
export async function one<T = any>(sql: string, params: any[] = [], db: Db = pool): Promise<T | null> {
  const rows = await query<T>(sql, params, db);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}
