import type { PoolClient } from "pg";
import { query, queryOne, tx, type Queryable } from "@/lib/db";
import { audit } from "@/lib/audit";
import { raiseAlert, resolveAlerts } from "@/lib/alerts";
import { enqueue } from "@/lib/jobs";
import { encryptJson } from "@/lib/crypto";
import { getSettings } from "@/lib/settings";
import { getMarketplace, marketplaceContextFor } from "@/modules/marketplace/registry";
import type { MarketplaceId, NormalizedOrder } from "@/modules/marketplace/types";
import { getAdapter } from "@/modules/suppliers/adapters/registry";
import { SupplierIntegrationError, type SupplierOrderRequest, type SupplierOrderState } from "@/modules/suppliers/adapters/types";
import { canAutoForward, getSupplier, supplierContext, type SupplierRow } from "@/modules/suppliers/service";
import { sellableStock } from "@/modules/catalog/service";
import { deriveOrderStatus, SUPPLIER_TRANSITIONS, type OrderStatus, type SupplierOrderStatus } from "./status";

export interface OrderRow {
  id: string;
  code: string;
  marketplace: MarketplaceId;
  account_id: string | null;
  external_order_id: string;
  external_shipment_id: string | null;
  status: OrderStatus;
  problem_reason: string | null;
  external_status: string | null;
  total_cents: string;
}

type TrackingStage = "received" | "forwarded" | "confirmed" | "preparing" | "dispatched" | "in_transit" | "delivered" | "cancelled" | "returned" | "problem";

export async function addTrackingEvent(
  client: Queryable,
  orderId: string,
  stage: TrackingStage,
  source: "marketplace" | "supplier" | "system" | "manual",
  description: string,
  occurredAt?: string | Date,
) {
  await query(
    `insert into tracking_events(order_id, stage, source, description, occurred_at)
     values ($1,$2,$3,$4, coalesce($5::timestamptz, now())) on conflict do nothing`,
    [orderId, stage, source, description, occurredAt ?? null],
    client,
  );
}

/** Recalcula e grava o status consolidado do pedido. */
export async function recomputeOrderStatus(client: Queryable, orderId: string): Promise<OrderStatus> {
  const o = await queryOne<{ status: OrderStatus; problem_reason: string | null; external_status: string | null; cancelled_at: string | null }>(
    "select status, problem_reason, external_status, cancelled_at from orders where id = $1",
    [orderId],
    client,
  );
  if (!o) throw new Error("Pedido não encontrado");
  const so = await query<{ status: SupplierOrderStatus }>("select status from supplier_orders where order_id = $1", [orderId], client);
  const ship = await queryOne<{ stage: string }>(
    `select stage from tracking_events where order_id = $1 and source = 'marketplace'
       and stage in ('preparing','dispatched','in_transit','delivered','cancelled','problem')
     order by occurred_at desc, id desc limit 1`,
    [orderId],
    client,
  );
  const returned = await queryOne("select 1 from returns where order_id = $1 and status in ('received','sent_to_supplier','received_by_supplier','closed')", [orderId], client);
  const next = deriveOrderStatus({
    cancelled: Boolean(o.cancelled_at),
    returned: Boolean(returned),
    shipmentStage: ship?.stage ?? null,
    problemReason: o.problem_reason,
    supplierStatuses: so.map((s) => s.status),
  });
  if (next !== o.status) {
    await query(
      `update orders set status = $2, delivered_at = case when $2 = 'delivered' then coalesce(delivered_at, now()) else delivered_at end where id = $1`,
      [orderId, next],
      client,
    );
  }
  return next;
}

async function setProblem(client: Queryable, orderId: string, reason: string | null) {
  await query("update orders set problem_reason = $2 where id = $1", [orderId, reason], client);
}

// ---------------------------------------------------------------------------
// 1–5. Recebimento e consulta oficial do pedido
// ---------------------------------------------------------------------------

/** Vincula um item vendido ao produto/variação/fornecedor do DropFlow. */
async function mapItem(client: Queryable, marketplace: MarketplaceId, it: NormalizedOrder["items"][number]) {
  const byVariation = it.externalVariationId
    ? await queryOne<{ variant_id: string }>(
        `select lv.variant_id from listing_variations lv join listings l on l.id = lv.listing_id
         where l.marketplace = $1 and l.external_id = $2 and lv.external_variation_id = $3 and lv.variant_id is not null`,
        [marketplace, it.externalItemId, it.externalVariationId],
        client,
      )
    : null;
  let variantId = byVariation?.variant_id ?? null;
  if (!variantId && !it.externalVariationId) {
    const byListing = await queryOne<{ variant_id: string }>(
      `select v.id as variant_id from listings l join product_variants v on v.product_id = l.product_id and v.is_default
       where l.marketplace = $1 and l.external_id = $2`,
      [marketplace, it.externalItemId],
      client,
    );
    variantId = byListing?.variant_id ?? null;
  }
  if (!variantId && it.sellerSku) {
    const bySku = await queryOne<{ variant_id: string }>("select id as variant_id from product_variants where sku = $1", [it.sellerSku], client);
    variantId = bySku?.variant_id ?? null;
  }
  if (!variantId) return null;
  return queryOne<{ variant_id: string; product_id: string; supplier_id: string; unit_cost: string }>(
    `select v.id as variant_id, p.id as product_id, p.supplier_id, coalesce(v.cost_cents, p.cost_cents) as unit_cost
     from product_variants v join products p on p.id = v.product_id where v.id = $1`,
    [variantId],
    client,
  );
}

/**
 * Sincroniza um pedido a partir dos dados OFICIAIS do marketplace (nunca do corpo
 * da notificação). Idempotente: pode ser chamado várias vezes para o mesmo pedido.
 */
export async function syncOrder(params: { marketplace: MarketplaceId; accountId: string | null; externalOrderId: string }) {
  const { adapter, account } = await marketplaceContextFor(params.marketplace, params.accountId);
  const order = await adapter.getOrder(account, params.externalOrderId);
  const settings = await getSettings();

  const result = await tx(async (c) => {
    const existing = await queryOne<OrderRow & { cancelled_at: string | null }>(
      "select * from orders where marketplace = $1 and external_order_id = $2 for update",
      [params.marketplace, order.externalOrderId],
      c,
    );
    const feeTotal = order.items.reduce((s, i) => s + i.saleFeeCents * i.quantity, 0);
    const buyerEnc = order.buyer.name ? encryptJson({ name: order.buyer.name }) : null;
    let orderId: string;
    let created = false;
    if (!existing) {
      const code = await queryOne<{ code: string }>("select 'DF-' || lpad(nextval('order_code_seq')::text, 6, '0') as code", [], c);
      const row = await queryOne<{ id: string }>(
        `insert into orders(code, marketplace, account_id, external_order_id, external_pack_id, external_status, status,
           total_cents, marketplace_fee_cents, currency, buyer_nickname, buyer_data_enc, external_shipment_id, ordered_at, paid_at, raw)
         values ($1,$2,$3,$4,$5,$6,'received',$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
        [code!.code, params.marketplace, params.accountId, order.externalOrderId, order.externalPackId, order.externalStatus,
         order.totalCents, feeTotal, order.currency, order.buyer.nickname, buyerEnc, order.shipmentId, order.orderedAt, order.paidAt,
         JSON.stringify(order.raw)],
        c,
      );
      orderId = row!.id;
      created = true;
      await addTrackingEvent(c, orderId, "received", "marketplace", "Venda recebida do marketplace", order.orderedAt);
      await audit({ actor: "worker", action: "order.received", entityType: "order", entityId: orderId, details: { external: order.externalOrderId, marketplace: params.marketplace } }, c);
    } else {
      orderId = existing.id;
      await query(
        `update orders set external_status=$2, total_cents=$3, marketplace_fee_cents=$4, external_shipment_id=coalesce($5, external_shipment_id),
           paid_at=coalesce(paid_at, $6), raw=$7, buyer_data_enc = case when buyer_data_purged_at is null then coalesce($8, buyer_data_enc) else null end
         where id=$1`,
        [orderId, order.externalStatus, order.totalCents, feeTotal, order.shipmentId, order.paidAt, JSON.stringify(order.raw), buyerEnc],
        c,
      );
    }

    for (const it of order.items) {
      const mapped = await mapItem(c, params.marketplace, it);
      await query(
        `insert into order_items(order_id, external_item_id, external_variation_id, seller_sku, title, quantity, unit_price_cents,
           sale_fee_cents, variant_id, product_id, supplier_id, unit_cost_cents)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict ${it.externalVariationId ? "(order_id, external_item_id, external_variation_id)" : "(order_id, external_item_id) where external_variation_id is null"}
         do update set quantity=excluded.quantity, unit_price_cents=excluded.unit_price_cents, sale_fee_cents=excluded.sale_fee_cents,
           variant_id=coalesce(order_items.variant_id, excluded.variant_id), product_id=coalesce(order_items.product_id, excluded.product_id),
           supplier_id=coalesce(order_items.supplier_id, excluded.supplier_id), unit_cost_cents=coalesce(order_items.unit_cost_cents, excluded.unit_cost_cents)`,
        [orderId, it.externalItemId, it.externalVariationId, it.sellerSku, it.title, it.quantity, it.unitPriceCents, it.saleFeeCents,
         mapped?.variant_id ?? null, mapped?.product_id ?? null, mapped?.supplier_id ?? null, mapped ? Number(mapped.unit_cost) : null],
        c,
      );
    }

    if (order.status === "cancelled" && !existing?.cancelled_at) {
      await handleCancellation(c, orderId);
    }
    await recomputeOrderStatus(c, orderId);
    return { orderId, created };
  });

  if (order.shipmentId) {
    await enqueue("shipment.sync", { marketplace: params.marketplace, accountId: params.accountId, shipmentId: order.shipmentId }, { dedupeKey: `shipment.sync:${params.marketplace}:${order.shipmentId}` });
  }
  if (order.status === "paid") {
    await evaluateAndForward(result.orderId, settings.auto_forward_orders_enabled);
  }
  return result;
}

async function handleCancellation(c: PoolClient, orderId: string) {
  await query("update orders set cancelled_at = now() where id = $1", [orderId], c);
  await releaseReservations(c, orderId);
  const forwarded = await query<{ id: string; supplier_id: string; status: string }>(
    "select id, supplier_id, status from supplier_orders where order_id = $1 and status in ('submitted','manual_required','confirmed','preparing','dispatched')",
    [orderId],
    c,
  );
  await query("update supplier_orders set status='cancelled' where order_id=$1 and status in ('pending','awaiting_approval','failed')", [orderId], c);
  await addTrackingEvent(c, orderId, "cancelled", "marketplace", "Venda cancelada no marketplace");
  if (forwarded.length) {
    await raiseAlert({
      severity: "critical",
      type: "cancelled_after_forward",
      title: "Venda cancelada após envio ao fornecedor",
      message: "Contate o fornecedor para cancelar o pedido. O DropFlow não cancela automaticamente no fornecedor.",
      entityType: "order",
      entityId: orderId,
      dedupeKey: `cancelled_after_forward:${orderId}`,
    }, c);
  }
}

async function releaseReservations(c: Queryable, orderId: string) {
  const reserved = await query<{ variant_id: string; quantity: number }>(
    `select variant_id, -sum(delta)::int as quantity from inventory_movements
     where reference = $1 and reason in ('order_reserve','order_release') group by variant_id having -sum(delta) > 0`,
    [`order:${orderId}`],
    c,
  );
  // reservas são registradas com delta negativo de "reservado" (ver reserve); liberação devolve
  for (const r of reserved) {
    await query("update inventory set reserved = greatest(0, reserved - $2) where variant_id = $1", [r.variant_id, r.quantity], c);
    await query("insert into inventory_movements(variant_id, delta, reason, reference) values ($1,$2,'order_release',$3)", [r.variant_id, r.quantity, `order:${orderId}`], c);
  }
}

// ---------------------------------------------------------------------------
// 5–7. Identificação do fornecedor, estoque e encaminhamento
// ---------------------------------------------------------------------------

/**
 * Verifica vínculo e estoque e cria os pedidos aos fornecedores (um por fornecedor).
 * Nunca encaminha sem estoque. Idempotente por pedido (lock + chaves únicas).
 */
export async function evaluateAndForward(orderId: string, autoForwardSetting: boolean) {
  const settings = await getSettings();
  const toSubmit: string[] = [];
  await tx(async (c) => {
    const o = await queryOne<OrderRow & { cancelled_at: string | null }>("select * from orders where id = $1 for update", [orderId], c);
    if (!o || o.cancelled_at) return;
    const existing = await queryOne("select 1 from supplier_orders where order_id = $1 and status <> 'cancelled' limit 1", [orderId], c);
    if (existing) return;

    const items = await query<{ id: string; title: string; quantity: number; variant_id: string | null; supplier_id: string | null; unit_cost_cents: string | null }>(
      "select id, title, quantity, variant_id, supplier_id, unit_cost_cents from order_items where order_id = $1",
      [orderId],
      c,
    );
    const unmapped = items.filter((i) => !i.variant_id || !i.supplier_id);
    if (unmapped.length) {
      await setProblem(c, orderId, "mapping_missing");
      await raiseAlert({
        severity: "critical", type: "mapping_missing", title: `Pedido ${o.code}: item sem produto vinculado`,
        message: unmapped.map((u) => u.title).join(", "), entityType: "order", entityId: orderId, dedupeKey: `mapping_missing:${orderId}`,
      }, c);
      await recomputeOrderStatus(c, orderId);
      return;
    }

    // verificação de estoque com lock nas linhas de inventário
    const shortages: string[] = [];
    for (const i of items) {
      const inv = await queryOne<{ quantity: number; reserved: number }>("select quantity, reserved from inventory where variant_id = $1 for update", [i.variant_id], c);
      const available = sellableStock(inv?.quantity ?? 0, inv?.reserved ?? 0, settings.stock_safety_margin);
      if (available < i.quantity) shortages.push(`${i.title} (pedido ${i.quantity}, disponível ${available})`);
    }
    if (shortages.length) {
      await setProblem(c, orderId, "out_of_stock");
      await raiseAlert({
        severity: "critical", type: "out_of_stock", title: `Pedido ${o.code}: sem estoque no fornecedor`,
        message: `Pedido NÃO encaminhado. ${shortages.join("; ")}`, entityType: "order", entityId: orderId, dedupeKey: `out_of_stock:${orderId}`,
      }, c);
      await recomputeOrderStatus(c, orderId);
      return;
    }

    for (const i of items) {
      await query("update inventory set reserved = reserved + $2, updated_at = now() where variant_id = $1", [i.variant_id, i.quantity], c);
      await query("insert into inventory_movements(variant_id, delta, reason, reference) values ($1,$2,'order_reserve',$3)", [i.variant_id, -i.quantity, `order:${orderId}`], c);
    }

    const bySupplier = new Map<string, typeof items>();
    for (const i of items) bySupplier.set(i.supplier_id!, [...(bySupplier.get(i.supplier_id!) ?? []), i]);

    for (const [supplierId, its] of bySupplier) {
      const supplier = (await getSupplier(supplierId, c))!;
      const gate = canAutoForward(supplier, settings.operation_mode);
      const auto = autoForwardSetting && gate.ok;
      const total = its.reduce((s, i) => s + Number(i.unit_cost_cents ?? 0) * i.quantity, 0);
      const so = await queryOne<{ id: string }>(
        `insert into supplier_orders(order_id, supplier_id, idempotency_key, status, total_cost_cents)
         values ($1,$2,$3,$4,$5) on conflict (order_id, supplier_id) do nothing returning id`,
        [orderId, supplierId, `${o.code}-${supplierId.slice(0, 8)}`, auto ? "pending" : "awaiting_approval", total],
        c,
      );
      if (!so) continue;
      if (auto) toSubmit.push(so.id);
      else {
        await raiseAlert({
          severity: "warning", type: "forward_approval", title: `Pedido ${o.code} aguardando encaminhamento a ${supplier.name}`,
          message: autoForwardSetting ? `Automação não aplicada: ${gate.reason}.` : "Encaminhamento automático desativado. Aprove o envio na tela do pedido.",
          entityType: "order", entityId: orderId, dedupeKey: `forward_approval:${so.id}`,
        }, c);
      }
    }
    await setProblem(c, orderId, null);
    await resolveAlerts(`out_of_stock:${orderId}`, c);
    await resolveAlerts(`mapping_missing:${orderId}`, c);
    await recomputeOrderStatus(c, orderId);
  });
  for (const id of toSubmit) await enqueue("supplier_order.submit", { supplierOrderId: id }, { dedupeKey: `so.submit:${id}` });
  return { queued: toSubmit.length };
}

/** Re-tenta a análise de um pedido com problema (ex.: após repor estoque ou vincular o produto). */
export async function retryOrder(orderId: string, userId: string) {
  const o = await queryOne<{ marketplace: MarketplaceId; account_id: string | null; external_order_id: string }>(
    "select marketplace, account_id, external_order_id from orders where id = $1",
    [orderId],
  );
  if (!o) throw new Error("Pedido não encontrado");
  await audit({ userId, action: "order.retry", entityType: "order", entityId: orderId });
  return syncOrder({ marketplace: o.marketplace, accountId: o.account_id, externalOrderId: o.external_order_id });
}

/** Aprovação manual do encaminhamento (fornecedores sem automação ou automação desligada). */
export async function approveSupplierOrder(supplierOrderId: string, userId: string) {
  const r = await queryOne<{ id: string }>(
    "update supplier_orders set status='pending' where id=$1 and status in ('awaiting_approval','failed') returning id",
    [supplierOrderId],
  );
  if (!r) throw new Error("Este pedido ao fornecedor não está aguardando aprovação.");
  await resolveAlerts(`forward_approval:${supplierOrderId}`);
  await audit({ userId, action: "supplier_order.approve", entityType: "supplier_order", entityId: supplierOrderId });
  await enqueue("supplier_order.submit", { supplierOrderId }, { dedupeKey: `so.submit:${supplierOrderId}` });
}

export function logisticsInstructions(marketplace: string, shipmentId: string | null, logisticType: string | null): string {
  if (marketplace === "simulated") return "Envio simulado (modo teste).";
  return [
    `Envio pelo Mercado Envios${shipmentId ? ` (envio nº ${shipmentId})` : ""}${logisticType ? `, modalidade ${logisticType}` : ""}.`,
    "Use EXCLUSIVAMENTE a etiqueta oficial do Mercado Livre enviada junto com este pedido.",
    "Não substitua a etiqueta, a transportadora nem a modalidade logística. Não crie código de rastreio próprio.",
  ].join(" ");
}

/** Envia o pedido ao fornecedor pela integração configurada (ou gera o pedido manual). */
export async function submitSupplierOrder(supplierOrderId: string) {
  const so = await queryOne<{ id: string; order_id: string; supplier_id: string; status: string; idempotency_key: string; attempts: number }>(
    "select id, order_id, supplier_id, status, idempotency_key, attempts from supplier_orders where id = $1",
    [supplierOrderId],
  );
  if (!so || so.status !== "pending") return; // idempotente: já enviado, cancelado etc.
  const order = await queryOne<{ id: string; code: string; marketplace: string; external_order_id: string; external_shipment_id: string | null; cancelled_at: string | null }>(
    "select id, code, marketplace, external_order_id, external_shipment_id, cancelled_at from orders where id = $1",
    [so.order_id],
  );
  if (!order || order.cancelled_at) {
    await query("update supplier_orders set status='cancelled' where id=$1", [so.id]);
    return;
  }
  const supplier = (await getSupplier(so.supplier_id)) as SupplierRow;
  const items = await query<{ supplier_sku: string; title: string; quantity: number; unit_cost_cents: string }>(
    `select v.supplier_sku, oi.title, oi.quantity, coalesce(oi.unit_cost_cents, 0) as unit_cost_cents
     from order_items oi join product_variants v on v.id = oi.variant_id
     where oi.order_id = $1 and oi.supplier_id = $2`,
    [order.id, so.supplier_id],
  );
  const ship = await queryOne<{ logistic_type: string | null }>("select logistic_type from shipments where order_id = $1", [order.id]);
  const request: SupplierOrderRequest = {
    idempotencyKey: so.idempotency_key,
    orderCode: order.code,
    marketplaceOrderId: order.external_order_id,
    items: items.map((i) => ({ supplierSku: i.supplier_sku, title: i.title, quantity: i.quantity, unitCostCents: Number(i.unit_cost_cents) })),
    logistics: {
      marketplace: order.marketplace,
      shipmentId: order.external_shipment_id,
      logisticType: ship?.logistic_type ?? null,
      labelInstructions: logisticsInstructions(order.marketplace, order.external_shipment_id, ship?.logistic_type ?? null),
    },
    delivery: null, // Mercado Envios: o endereço vai na etiqueta oficial; não repassamos dados pessoais.
  };
  const adapter = getAdapter(supplier.integration_type);
  try {
    if (!adapter.submitOrder) throw new SupplierIntegrationError("Fornecedor sem método de envio de pedidos", false);
    const res = await adapter.submitOrder(await supplierContext(supplier), request);
    await applySupplierResponse(so.id, res.status, { externalReference: res.externalReference, message: res.message, source: "system", initial: true });
  } catch (e) {
    const retryable = e instanceof SupplierIntegrationError ? e.retryable : true;
    const attempts = so.attempts + 1;
    const final = !retryable || attempts >= 5;
    await query("update supplier_orders set attempts=$2, last_error=$3, status=$4 where id=$1", [so.id, attempts, (e as Error).message.slice(0, 1000), final ? "failed" : "pending"]);
    if (final) {
      await tx(async (c) => {
        await setProblem(c, order.id, "supplier_failed");
        await raiseAlert({
          severity: "critical", type: "supplier_failed", title: `Pedido ${order.code}: falha ao enviar a ${supplier.name}`,
          message: (e as Error).message.slice(0, 500), entityType: "order", entityId: order.id, dedupeKey: `supplier_failed:${so.id}`,
        }, c);
        await recomputeOrderStatus(c, order.id);
      });
      return;
    }
    throw e; // a fila tenta novamente com backoff
  }
}

/**
 * Aplica um novo status do pedido ao fornecedor (vindo da integração ou do operador).
 * Valida transições e NÃO aceita código de rastreio: o rastreio vem só do marketplace.
 */
export async function applySupplierResponse(
  supplierOrderId: string,
  status: SupplierOrderState,
  opts: { externalReference?: string; message?: string; source: "system" | "manual" | "supplier"; userId?: string; initial?: boolean },
) {
  await tx(async (c) => {
    const so = await queryOne<{ id: string; order_id: string; supplier_id: string; status: SupplierOrderStatus }>(
      "select id, order_id, supplier_id, status from supplier_orders where id = $1 for update",
      [supplierOrderId],
      c,
    );
    if (!so) throw new Error("Pedido ao fornecedor não encontrado");
    if (so.status === status) return;
    if (!SUPPLIER_TRANSITIONS[so.status].includes(status)) {
      throw new Error(`Transição inválida: ${so.status} → ${status}`);
    }
    const supplier = (await getSupplier(so.supplier_id, c))!;
    await query(
      `update supplier_orders set status=$2, external_reference=coalesce($3, external_reference), message=coalesce($4, message), last_error=null,
         submitted_at = case when $5 then coalesce(submitted_at, now()) else submitted_at end,
         confirmation_due_at = case when $5 then now() + ($6 || ' hours')::interval else confirmation_due_at end,
         confirmed_at = case when $2 in ('confirmed','preparing','dispatched') then coalesce(confirmed_at, now()) else confirmed_at end,
         dispatched_at = case when $2 = 'dispatched' then coalesce(dispatched_at, now()) else dispatched_at end
       where id=$1`,
      [so.id, status, opts.externalReference ?? null, opts.message ?? null, Boolean(opts.initial), String(supplier.confirmation_timeout_hours)],
      c,
    );
    const src = opts.source === "manual" ? "manual" : "supplier";
    if (opts.initial) {
      await query("update orders set forwarded_at = coalesce(forwarded_at, now()) where id = $1", [so.order_id], c);
      await addTrackingEvent(c, so.order_id, "forwarded", "system", `Pedido encaminhado a ${supplier.name}`);
    }
    if (["confirmed", "preparing", "dispatched"].includes(status) && !["confirmed", "preparing", "dispatched"].includes(so.status)) {
      await addTrackingEvent(c, so.order_id, "confirmed", src, `${supplier.name} confirmou o pedido`);
      await consumeReservation(c, so.order_id, so.supplier_id);
      await resolveAlerts(`supplier_timeout:${so.id}`, c);
      const o = await queryOne<{ problem_reason: string | null }>("select problem_reason from orders where id=$1", [so.order_id], c);
      if (o?.problem_reason === "supplier_timeout") await setProblem(c, so.order_id, null);
    }
    if (status === "preparing") await addTrackingEvent(c, so.order_id, "preparing", src, `${supplier.name} está preparando o pedido`);
    if (status === "dispatched") await addTrackingEvent(c, so.order_id, "dispatched", src, `${supplier.name} informou o despacho com a etiqueta oficial`);
    if (status === "rejected") {
      await releaseReservationsForSupplier(c, so.order_id, so.supplier_id);
      await setProblem(c, so.order_id, "supplier_rejected");
      await raiseAlert({
        severity: "critical", type: "supplier_rejected", title: `${supplier.name} recusou um pedido`,
        message: opts.message ?? undefined, entityType: "order", entityId: so.order_id, dedupeKey: `supplier_rejected:${so.id}`,
      }, c);
    }
    await audit({ userId: opts.userId ?? null, actor: opts.userId ? "user" : "worker", action: "supplier_order.status", entityType: "supplier_order", entityId: so.id, details: { from: so.status, to: status } }, c);
    await recomputeOrderStatus(c, so.order_id);
  });
  if (opts.initial && (status === "submitted" || status === "manual_required")) {
    const so = await queryOne<{ confirmation_due_at: string }>("select confirmation_due_at from supplier_orders where id = $1", [supplierOrderId]);
    await enqueue("supplier_order.check_timeout", { supplierOrderId }, { runAt: new Date(so!.confirmation_due_at), dedupeKey: `so.timeout:${supplierOrderId}` });
  }
}

/** Confirmação do fornecedor: a quantidade reservada sai do estoque disponível. */
async function consumeReservation(c: Queryable, orderId: string, supplierId: string) {
  const items = await query<{ variant_id: string; quantity: number }>(
    "select variant_id, quantity from order_items where order_id = $1 and supplier_id = $2 and variant_id is not null",
    [orderId, supplierId],
    c,
  );
  for (const i of items) {
    await query(
      "update inventory set quantity = greatest(0, quantity - $2), reserved = greatest(0, reserved - $2), updated_at = now() where variant_id = $1",
      [i.variant_id, i.quantity],
      c,
    );
    await query("insert into inventory_movements(variant_id, delta, reason, reference) values ($1,$2,'order_release',$3)", [i.variant_id, i.quantity, `order:${orderId}`], c);
    await query("insert into inventory_movements(variant_id, delta, reason, reference) values ($1,$2,'order_consume',$3)", [i.variant_id, -i.quantity, `order:${orderId}`], c);
  }
}

async function releaseReservationsForSupplier(c: Queryable, orderId: string, supplierId: string) {
  const items = await query<{ variant_id: string; quantity: number }>(
    "select variant_id, quantity from order_items where order_id = $1 and supplier_id = $2 and variant_id is not null",
    [orderId, supplierId],
    c,
  );
  for (const i of items) {
    await query("update inventory set reserved = greatest(0, reserved - $2) where variant_id = $1", [i.variant_id, i.quantity], c);
    await query("insert into inventory_movements(variant_id, delta, reason, reference) values ($1,$2,'order_release',$3)", [i.variant_id, i.quantity, `order:${orderId}`], c);
  }
}

/** Alerta quando o fornecedor não confirma no prazo. */
export async function checkSupplierTimeout(supplierOrderId: string) {
  const so = await queryOne<{ id: string; order_id: string; status: string; supplier_name: string; code: string; confirmation_due_at: string }>(
    `select so.id, so.order_id, so.status, s.name as supplier_name, o.code, so.confirmation_due_at
     from supplier_orders so join suppliers s on s.id = so.supplier_id join orders o on o.id = so.order_id where so.id = $1`,
    [supplierOrderId],
  );
  if (!so || !["submitted", "manual_required"].includes(so.status)) return;
  if (new Date(so.confirmation_due_at).getTime() > Date.now()) {
    await enqueue("supplier_order.check_timeout", { supplierOrderId }, { runAt: new Date(so.confirmation_due_at), dedupeKey: `so.timeout:${supplierOrderId}:later` });
    return;
  }
  await tx(async (c) => {
    await setProblem(c, so.order_id, "supplier_timeout");
    await raiseAlert({
      severity: "critical", type: "supplier_timeout", title: `${so.supplier_name} não confirmou o pedido ${so.code}`,
      message: "Prazo de confirmação expirado. Contate o fornecedor.", entityType: "order", entityId: so.order_id, dedupeKey: `supplier_timeout:${so.id}`,
    }, c);
    await recomputeOrderStatus(c, so.order_id);
  });
}

/** Consulta o status no fornecedor (somente integrações com essa capacidade). */
export async function pollSupplierOrder(supplierOrderId: string) {
  const so = await queryOne<{ id: string; supplier_id: string; status: string; external_reference: string | null }>(
    "select id, supplier_id, status, external_reference from supplier_orders where id = $1",
    [supplierOrderId],
  );
  if (!so?.external_reference || !["submitted", "confirmed", "preparing"].includes(so.status)) return;
  const supplier = (await getSupplier(so.supplier_id))!;
  const adapter = getAdapter(supplier.integration_type);
  if (!adapter.getOrderStatus) return;
  const res = await adapter.getOrderStatus(await supplierContext(supplier), so.external_reference);
  if (res.status !== so.status && SUPPLIER_TRANSITIONS[so.status as SupplierOrderStatus].includes(res.status as SupplierOrderStatus)) {
    await applySupplierResponse(so.id, res.status, { source: "supplier" });
  }
}

// ---------------------------------------------------------------------------
// 10–12. Envio e rastreamento (dados oficiais do marketplace)
// ---------------------------------------------------------------------------

export async function syncShipment(params: { marketplace: MarketplaceId; accountId: string | null; shipmentId: string }) {
  const adapter = getMarketplace(params.marketplace);
  const { account } = await marketplaceContextFor(params.marketplace, params.accountId);
  const s = await adapter.getShipment(account, params.shipmentId);
  const order = await queryOne<{ id: string }>(
    "select id from orders where marketplace = $1 and external_shipment_id = $2",
    [params.marketplace, params.shipmentId],
  );
  if (!order) throw new Error(`Envio ${params.shipmentId} ainda sem pedido correspondente`); // a fila tenta novamente
  await tx(async (c) => {
    await query(
      `insert into shipments(order_id, external_shipment_id, logistic_type, mode, status, substatus, tracking_number, tracking_method, carrier, last_synced_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       on conflict (order_id) do update set external_shipment_id=excluded.external_shipment_id, logistic_type=excluded.logistic_type,
         mode=excluded.mode, status=excluded.status, substatus=excluded.substatus,
         tracking_number=coalesce(excluded.tracking_number, shipments.tracking_number),
         tracking_method=coalesce(excluded.tracking_method, shipments.tracking_method), carrier=coalesce(excluded.carrier, shipments.carrier),
         last_synced_at=now()`,
      [order.id, s.externalShipmentId, s.logisticType, s.mode, s.status, s.substatus, s.trackingNumber, s.trackingMethod, s.carrier],
      c,
    );
    for (const e of s.events) await addTrackingEvent(c, order.id, e.stage, "marketplace", e.description, e.occurredAt);
    if (s.sellerCostCents !== null) await query("update orders set shipping_cost_cents = $2 where id = $1", [order.id, s.sellerCostCents], c);
    if (s.events.some((e) => e.stage === "problem")) {
      await raiseAlert({ severity: "critical", type: "delivery_problem", title: "Problema na entrega", entityType: "order", entityId: order.id, dedupeKey: `delivery_problem:${order.id}` }, c);
    }
    await recomputeOrderStatus(c, order.id);
  });
}

// ---------------------------------------------------------------------------
// Atualização manual pelo operador
// ---------------------------------------------------------------------------

export async function manualSupplierStatus(supplierOrderId: string, status: SupplierOrderState, userId: string, note?: string) {
  await applySupplierResponse(supplierOrderId, status, { source: "manual", userId, message: note });
}

export async function setSupplierPayment(supplierOrderId: string, paid: boolean, userId: string) {
  const so = await queryOne<{ id: string; order_id: string; supplier_id: string; total_cost_cents: string }>(
    "update supplier_orders set payment_status=$2, paid_at = case when $2='paid' then now() else null end where id=$1 returning id, order_id, supplier_id, total_cost_cents",
    [supplierOrderId, paid ? "paid" : "pending"],
  );
  if (!so) throw new Error("Pedido ao fornecedor não encontrado");
  if (paid) {
    await query(
      `insert into transactions(order_id, supplier_id, type, amount_cents, status, description, dedupe_key)
       values ($1,$2,'supplier_payment',$3,'realized','Pagamento ao fornecedor',$4)
       on conflict (dedupe_key) do update set status='realized'`,
      [so.order_id, so.supplier_id, -Number(so.total_cost_cents), `supplier_payment:${so.id}`],
    );
  } else {
    await query("update transactions set status='cancelled' where dedupe_key = $1", [`supplier_payment:${so.id}`]);
  }
  await audit({ userId, action: paid ? "supplier_order.paid" : "supplier_order.unpaid", entityType: "supplier_order", entityId: so.id });
}
