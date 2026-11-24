import { query, queryOne, type Queryable } from "./db";

export interface AppSettings {
  operation_mode: "test" | "production";
  auto_publish_enabled: boolean;
  auto_forward_orders_enabled: boolean;
  auto_stock_sync_enabled: boolean;
  stock_safety_margin: number;
  buyer_data_retention_days: number;
  price_rounding: "none" | "ninety";
}

const DEFAULTS: AppSettings = {
  operation_mode: "test",
  auto_publish_enabled: false,
  auto_forward_orders_enabled: false,
  auto_stock_sync_enabled: false,
  stock_safety_margin: 0,
  buyer_data_retention_days: 180,
  price_rounding: "none",
};

export async function getSettings(client?: Queryable): Promise<AppSettings> {
  const rows = await query<{ key: string; value: unknown }>("select key, value from settings", [], client);
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out as unknown as AppSettings;
}

export async function setSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
  userId: string | null,
  client?: Queryable,
) {
  await query(
    `insert into settings(key, value, updated_by, updated_at) values ($1, $2, $3, now())
     on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), userId],
    client,
  );
}

export async function getMode(client?: Queryable): Promise<"test" | "production"> {
  const row = await queryOne<{ value: string }>("select value from settings where key = 'operation_mode'", [], client);
  return (row?.value as "test" | "production") ?? "test";
}

/** Marketplace que alimenta os dados do modo atual. */
export async function activeMarketplace(client?: Queryable): Promise<"mercadolivre" | "simulated"> {
  return (await getMode(client)) === "production" ? "mercadolivre" : "simulated";
}
