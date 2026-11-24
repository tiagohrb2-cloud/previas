import { query, type Queryable } from "./db";

export interface AlertInput {
  severity?: "info" | "warning" | "critical";
  type: string;
  title: string;
  message?: string;
  entityType?: string;
  entityId?: string;
  /** Alertas com a mesma chave não são duplicados enquanto existirem. */
  dedupeKey?: string;
}

export async function raiseAlert(a: AlertInput, client?: Queryable) {
  await query(
    `insert into alerts(severity, type, title, message, entity_type, entity_id, dedupe_key)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (dedupe_key) do update set
       message = excluded.message,
       severity = excluded.severity,
       resolved_at = null,
       read_at = null,
       created_at = case when alerts.resolved_at is null then alerts.created_at else now() end`,
    [a.severity ?? "warning", a.type, a.title, a.message ?? null, a.entityType ?? null, a.entityId ?? null, a.dedupeKey ?? null],
    client,
  );
}

export async function resolveAlerts(dedupeKey: string, client?: Queryable) {
  await query("update alerts set resolved_at = now() where dedupe_key = $1 and resolved_at is null", [dedupeKey], client);
}
