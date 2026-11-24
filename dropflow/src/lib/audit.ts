import { query, type Queryable } from "./db";

export interface AuditEntry {
  userId?: string | null;
  actor?: "user" | "system" | "webhook" | "worker";
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ip?: string | null;
}

/** Registro de atividades. Nunca inclua tokens, senhas ou dados pessoais em `details`. */
export async function audit(entry: AuditEntry, client?: Queryable) {
  await query(
    `insert into audit_logs(user_id, actor, action, entity_type, entity_id, details, ip)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      entry.userId ?? null,
      entry.actor ?? (entry.userId ? "user" : "system"),
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      JSON.stringify(entry.details ?? {}),
      entry.ip ?? null,
    ],
    client,
  );
}
