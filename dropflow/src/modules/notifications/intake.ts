import { z } from "zod";
import { createHash } from "node:crypto";
import { query, queryOne } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { env } from "@/lib/env";
import type { MarketplaceId } from "@/modules/marketplace/types";

/**
 * Notificação do Mercado Livre. O corpo NÃO é confiável: serve apenas para saber
 * QUAL recurso mudou. Os dados reais são sempre consultados na API oficial.
 */
export const mlNotificationSchema = z.object({
  _id: z.string().optional(),
  resource: z.string().min(1).max(300),
  user_id: z.union([z.number(), z.string()]).transform(String),
  topic: z.string().min(1).max(60),
  application_id: z.union([z.number(), z.string()]).transform(String).optional(),
  attempts: z.number().optional(),
  sent: z.string().optional(),
  received: z.string().optional(),
});

export type MlNotification = z.infer<typeof mlNotificationSchema>;

export function resourceId(resource: string): string | null {
  const m = resource.match(/([A-Z]{0,4}\d+)\/?$/);
  return m ? m[1] : null;
}

export type IntakeResult = { status: "queued" | "duplicate" | "ignored"; reason?: string };

export async function ingestNotification(raw: unknown, marketplace: MarketplaceId = "mercadolivre"): Promise<IntakeResult> {
  const n = mlNotificationSchema.parse(raw);
  const e = env();
  if (marketplace === "mercadolivre" && n.application_id && e.ML_CLIENT_ID && n.application_id !== e.ML_CLIENT_ID) {
    return { status: "ignored", reason: "application_id diferente do aplicativo configurado" };
  }
  const account = marketplace === "mercadolivre"
    ? await queryOne<{ id: string }>("select id from ml_accounts where ml_user_id = $1 and status <> 'revoked'", [n.user_id])
    : { id: null as unknown as string };
  // id de notificação estável para idempotência (o ML reenvia a mesma notificação)
  const notificationId = n._id ?? createHash("sha256").update(`${n.topic}|${n.resource}|${n.sent ?? ""}`).digest("hex");
  const inserted = await queryOne<{ id: string }>(
    `insert into marketplace_notifications(marketplace, notification_id, topic, resource, external_user_id, attempts, payload, status)
     values ($1,$2,$3,$4,$5,$6,$7,'pending') on conflict (marketplace, notification_id) do nothing returning id`,
    [marketplace, notificationId, n.topic, n.resource, n.user_id, n.attempts ?? null, JSON.stringify(n)],
  );
  if (!inserted) return { status: "duplicate" };
  if (marketplace === "mercadolivre" && !account) {
    await query("update marketplace_notifications set status='ignored', error='conta não conectada', processed_at=now() where id=$1", [inserted.id]);
    return { status: "ignored", reason: "conta não conectada" };
  }
  const id = resourceId(n.resource);
  const accountId = account?.id ?? null;
  const topic = n.topic;
  let job: [string, Record<string, unknown>, string] | null = null;
  if (id && (topic === "orders_v2" || topic === "orders")) job = ["order.sync", { marketplace, accountId, externalOrderId: id }, `order.sync:${marketplace}:${id}`];
  else if (id && topic === "shipments") job = ["shipment.sync", { marketplace, accountId, shipmentId: id }, `shipment.sync:${marketplace}:${id}`];
  else if (id && (topic === "claims" || topic === "post_purchase" || topic === "claims_actions")) job = ["claim.sync", { marketplace, accountId, claimId: id }, `claim.sync:${marketplace}:${id}`];
  else if (id && topic === "items") job = ["listing.refresh", { marketplace, accountId, externalId: id }, `listing.refresh:${marketplace}:${id}`];

  if (!job) {
    await query("update marketplace_notifications set status='ignored', error='tópico não tratado', processed_at=now() where id=$1", [inserted.id]);
    return { status: "ignored", reason: `tópico ${topic} não tratado` };
  }
  await enqueue(job[0], { ...job[1], notificationRowId: inserted.id }, { dedupeKey: job[2] });
  return { status: "queued" };
}

export async function markNotification(rowId: unknown, ok: boolean, error?: string) {
  if (!rowId) return;
  await query("update marketplace_notifications set status=$2, error=$3, processed_at=now() where id=$1", [rowId, ok ? "processed" : "failed", error ?? null]);
}
