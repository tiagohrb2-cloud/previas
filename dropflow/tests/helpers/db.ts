import { pool, query } from "@/lib/db";
import { migrate } from "@/lib/migrate";

/** Recria o schema do banco de testes do zero e aplica as migrações. */
export async function resetDatabase() {
  const p = pool();
  await p.query("drop schema if exists public cascade; create schema public;");
  await migrate(p, undefined, () => undefined);
}

export async function setSetting(key: string, value: unknown) {
  await query("update settings set value = $2 where key = $1", [key, JSON.stringify(value)]);
}
