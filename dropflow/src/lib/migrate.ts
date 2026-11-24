import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

/** Aplica, em ordem, as migrações de db/migrations ainda não aplicadas. */
export async function migrate(pool: Pool, dir = path.join(process.cwd(), "db", "migrations"), log = console.log) {
  await pool.query(`create table if not exists schema_migrations (
    version text primary key, applied_at timestamptz not null default now())`);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set((await pool.query("select version from schema_migrations")).rows.map((r) => r.version));
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations(version) values ($1)", [file]);
      await client.query("commit");
      log(`✔ migração aplicada: ${file}`);
    } catch (e) {
      await client.query("rollback");
      throw new Error(`Falha na migração ${file}: ${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
}
