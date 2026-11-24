import { query } from "@/lib/db";
import { runJobs, enqueue, type JobHandler } from "@/lib/jobs";
import { getSettings } from "@/lib/settings";
import type { MarketplaceId } from "@/modules/marketplace/types";
import { markNotification } from "@/modules/notifications/intake";
import { checkSupplierTimeout, pollSupplierOrder, submitSupplierOrder, syncOrder, syncShipment } from "@/modules/orders/processor";
import { syncClaim } from "@/modules/issues/service";
import { autoPublishCandidates, refreshListing, syncListing } from "@/modules/listings/service";
import { syncSupplierStock } from "@/modules/catalog/service";

type P = Record<string, unknown>;

/** Marca a notificação de origem como processada/falha. */
function tracked(fn: (p: P) => Promise<void>): JobHandler {
  return async (p) => {
    try {
      await fn(p);
      await markNotification(p.notificationRowId, true);
    } catch (e) {
      await markNotification(p.notificationRowId, false, (e as Error).message.slice(0, 500));
      throw e;
    }
  };
}

export const handlers: Record<string, JobHandler> = {
  "order.sync": tracked(async (p) => {
    await syncOrder({ marketplace: p.marketplace as MarketplaceId, accountId: (p.accountId as string) ?? null, externalOrderId: String(p.externalOrderId) });
  }),
  "shipment.sync": tracked(async (p) => {
    await syncShipment({ marketplace: p.marketplace as MarketplaceId, accountId: (p.accountId as string) ?? null, shipmentId: String(p.shipmentId) });
  }),
  "claim.sync": tracked(async (p) => {
    await syncClaim({ marketplace: p.marketplace as MarketplaceId, accountId: (p.accountId as string) ?? null, claimId: String(p.claimId) });
  }),
  "listing.refresh": tracked(async (p) => {
    await refreshListing({ marketplace: p.marketplace as MarketplaceId, accountId: (p.accountId as string) ?? null, externalId: String(p.externalId) });
  }),
  "listing.sync": async (p) => syncListing(String(p.listingId)),
  "supplier_order.submit": async (p) => submitSupplierOrder(String(p.supplierOrderId)),
  "supplier_order.check_timeout": async (p) => checkSupplierTimeout(String(p.supplierOrderId)),
  "supplier_order.poll": async (p) => pollSupplierOrder(String(p.supplierOrderId)),
  "supplier.stock_sync": async (p) => {
    await syncSupplierStock(String(p.supplierId));
  },
  "maintenance.periodic": async () => periodic(),
};

/**
 * Rotinas periódicas (chamadas pelo worker ou pelo cron):
 * - consulta status nos fornecedores com API
 * - sincroniza estoque dos fornecedores com API (se autorizado)
 * - publicação automática (se autorizada)
 * - LGPD: apaga dados pessoais de pedidos entregues/cancelados após o prazo de retenção
 */
export async function periodic() {
  const settings = await getSettings();
  const polling = await query<{ id: string }>(
    `select so.id from supplier_orders so join suppliers s on s.id = so.supplier_id
     where s.integration_type in ('rest','simulated') and so.status in ('submitted','confirmed','preparing') and so.external_reference is not null`,
  );
  for (const r of polling) await enqueue("supplier_order.poll", { supplierOrderId: r.id }, { dedupeKey: `so.poll:${r.id}` });
  if (settings.auto_stock_sync_enabled) {
    const sup = await query<{ id: string }>("select id from suppliers where active and integration_type = 'rest' and integration_status = 'verified'");
    for (const s of sup) await enqueue("supplier.stock_sync", { supplierId: s.id }, { dedupeKey: `stock:${s.id}` });
  }
  await autoPublishCandidates();
  await query(
    `update orders set buyer_data_enc = null, buyer_data_purged_at = now()
     where buyer_data_enc is not null and buyer_data_purged_at is null
       and coalesce(delivered_at, cancelled_at) < now() - ($1 || ' days')::interval`,
    [String(settings.buyer_data_retention_days)],
  );
  await query("delete from sessions where expires_at < now()");
  await query("delete from login_attempts where created_at < now() - interval '30 days'");
  await query("delete from jobs where status = 'done' and finished_at < now() - interval '30 days'");
}

export async function processQueue(limit = 50) {
  return runJobs(handlers, limit);
}
