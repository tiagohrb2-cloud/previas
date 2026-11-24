import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { env } from "./env";

declare global {
  // eslint-disable-next-line no-var
  var __dropflowPool: Pool | undefined;
}

export function pool(): Pool {
  if (!globalThis.__dropflowPool) {
    const e = env();
    globalThis.__dropflowPool = new Pool({
      connectionString: e.DATABASE_URL,
      ssl: e.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
      max: 10,
    });
  }
  return globalThis.__dropflowPool;
}

export type Queryable = Pick<PoolClient, "query">;

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  client?: Queryable,
): Promise<T[]> {
  const res = await (client ?? pool()).query<T>(sql, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  client?: Queryable,
): Promise<T | null> {
  const rows = await query<T>(sql, params, client);
  return rows[0] ?? null;
}

/** Executa uma função dentro de uma transação. Faz rollback em caso de erro. */
export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (globalThis.__dropflowPool) {
    await globalThis.__dropflowPool.end();
    globalThis.__dropflowPool = undefined;
  }
}
