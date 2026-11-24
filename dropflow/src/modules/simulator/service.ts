import { query, queryOne } from "@/lib/db";
import { getMode } from "@/lib/settings";

import { audit } from "@/lib/audit";
import { saveSim } from "@/modules/marketplace/simulated";
import type { NormalizedClaim, NormalizedOrder, NormalizedShipment } from "@/modules/marketplace/types";
import { ingestNotification } from "@/modules/notifications/intake";

/**
 * Simulador do MODO TESTE. Cria eventos fictícios no marketplace simulado e
 * dispara notificações iguais às do Mercado Livre, passando pelo MESMO
 * fluxo de processamento usado em produção.
 */
async function guard() {
  if ((await getMode()) !== "test") throw new Error("O simulador só funciona no modo teste.");
}

async function notify(topic: string, resource: string) {
  await ingestNotification({ _id: `sim-${topic}-${resource}-${Date.now()}-${Math.random()}`, resource, user_id: "SIMULATED", topic }, "simulated");
}

export async function simulateSale(input: { listingId: string; variationExternalId?: string | null; quantity: number; buyerName?: string }, userId: string) {
  await guard();
  const l = await queryOne<{ external_id: string; title: string; price_cents: string; listing_type_id: string | null; pricing_snapshot: { commissionCents?: number; fixedFeeCents?: number; priceCents?: number } | null }>(
    "select external_id, title, price_cents, listing_type_id, pricing_snapshot from listings where id = $1 and marketplace = 'simulated'",
    [input.listingId],
  );
  if (!l) throw new Error("Anúncio simulado não encontrado. Publique um produto no modo teste primeiro.");
  const qty = Math.max(1, Math.floor(input.quantity));
  const n = await queryOne<{ n: string }>("select count(*) as n from simulation_store where kind = 'order'");
  const id = String(2000000000 + Number(n?.n ?? 0) + 1);
  const shipmentId = `4${id}`;
  const price = Number(l.price_cents);
  const snap = l.pricing_snapshot;
  const unitFee = snap?.priceCents ? (snap.commissionCents ?? 0) + (snap.fixedFeeCents ?? 0) : 0;
  let sellerSku: string | null = null;
  if (input.variationExternalId) {
    const lv = await queryOne<{ seller_sku: string | null }>("select seller_sku from listing_variations where external_variation_id = $1", [input.variationExternalId]);
    sellerSku = lv?.seller_sku ?? null;
  }
  const now = new Date().toISOString();
  const order: NormalizedOrder = {
    externalOrderId: id, externalPackId: null, externalStatus: "paid", status: "paid", orderedAt: now, paidAt: now,
    totalCents: price * qty, currency: "BRL",
    buyer: { nickname: `COMPRADOR_TESTE_${id.slice(-4)}`, name: input.buyerName || "Comprador Teste" },
    shipmentId,
    items: [{ externalItemId: l.external_id, externalVariationId: input.variationExternalId ?? null, sellerSku, title: l.title, quantity: qty, unitPriceCents: price, saleFeeCents: unitFee }],
    raw: { simulated: true },
  };
  await saveSim("order", id, order);
  const shipment: NormalizedShipment = {
    externalShipmentId: shipmentId, status: "pending", substatus: null, mode: "me2", logisticType: "drop_off",
    trackingNumber: null, trackingMethod: null, carrier: null, sellerCostCents: 0, events: [],
  };
  await saveSim("shipment", shipmentId, shipment);
  await notify("orders_v2", `/orders/${id}`);
  await audit({ userId, action: "simulator.sale", details: { orderId: id } });
  return id;
}

export async function simulateCancel(externalOrderId: string, userId: string) {
  await guard();
  const r = await queryOne<{ data: NormalizedOrder }>("select data from simulation_store where kind='order' and external_id=$1", [externalOrderId]);
  if (!r) throw new Error("Pedido simulado não encontrado");
  await saveSim("order", externalOrderId, { ...r.data, status: "cancelled", externalStatus: "cancelled" });
  await notify("orders_v2", `/orders/${externalOrderId}`);
  await audit({ userId, action: "simulator.cancel", details: { externalOrderId } });
}

const SHIP_FLOW: Record<string, { status: string; substatus: string | null; stage: NormalizedShipment["events"][number]["stage"]; description: string }> = {
  ready_to_ship: { status: "ready_to_ship", substatus: "ready_to_print", stage: "preparing", description: "Etiqueta disponível / aguardando despacho" },
  dropped_off: { status: "ready_to_ship", substatus: "dropped_off", stage: "dispatched", description: "Pacote entregue à transportadora" },
  shipped: { status: "shipped", substatus: null, stage: "in_transit", description: "Em trânsito" },
  delivered: { status: "delivered", substatus: null, stage: "delivered", description: "Entregue ao comprador" },
  not_delivered: { status: "not_delivered", substatus: null, stage: "problem", description: "Problema na entrega" },
};

export async function simulateShipment(shipmentId: string, step: keyof typeof SHIP_FLOW, userId: string) {
  await guard();
  const r = await queryOne<{ data: NormalizedShipment }>("select data from simulation_store where kind='shipment' and external_id=$1", [shipmentId]);
  if (!r) throw new Error("Envio simulado não encontrado");
  const f = SHIP_FLOW[step];
  if (!f) throw new Error("Etapa inválida");
  const s = r.data;
  s.status = f.status;
  s.substatus = f.substatus;
  // código de rastreio gerado pelo MARKETPLACE simulado (nunca pelo fornecedor)
  if (!s.trackingNumber && (step === "dropped_off" || step === "shipped")) s.trackingNumber = `SIMRASTREIO${shipmentId.slice(-6)}`;
  s.events = [...s.events, { stage: f.stage, occurredAt: new Date().toISOString(), description: f.description }];
  await saveSim("shipment", shipmentId, s);
  await notify("shipments", `/shipments/${shipmentId}`);
  await audit({ userId, action: "simulator.shipment", details: { shipmentId, step } });
}

export async function simulateClaim(externalOrderId: string, type: "claim" | "return", userId: string) {
  await guard();
  const n = await queryOne<{ n: string }>("select count(*) as n from simulation_store where kind = 'claim'");
  const id = String(5000000000 + Number(n?.n ?? 0) + 1);
  const claim: NormalizedClaim = {
    externalClaimId: id, externalOrderId, type, reason: type === "return" ? "Produto diferente do anunciado (simulado)" : "Produto não chegou (simulado)",
    externalStatus: "opened", open: true, openedAt: new Date().toISOString(), dueAt: new Date(Date.now() + 3 * 86400000).toISOString(),
  };
  await saveSim("claim", id, claim);
  await notify("claims", `/post-purchase/v1/claims/${id}`);
  await audit({ userId, action: "simulator.claim", details: { externalOrderId, type } });
}

export async function simulateSupplierStock(supplierSku: string, stock: number, userId: string) {
  await guard();
  await saveSim("supplier_stock", supplierSku, { stock: Math.max(0, Math.floor(stock)) });
  await audit({ userId, action: "simulator.supplier_stock", details: { supplierSku, stock } });
}

export async function simulatedOrders() {
  return query<{ external_id: string; data: NormalizedOrder; updated_at: string }>(
    "select external_id, data, updated_at from simulation_store where kind='order' order by updated_at desc limit 30",
  );
}

