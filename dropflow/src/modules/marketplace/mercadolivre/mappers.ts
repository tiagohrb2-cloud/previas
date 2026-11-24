/**
 * Conversões entre os formatos da API oficial do Mercado Livre e os formatos
 * internos. Funções puras e defensivas: campos ausentes não quebram o fluxo.
 *
 * ATENÇÃO: os nomes de campos seguem a API pública do Mercado Livre
 * (orders, shipments, items, post-purchase/claims, listing_prices). Confira na
 * documentação oficial vigente antes de ativar o modo produção — ver docs/MERCADO_LIVRE.md.
 */
import type {
  CategoryAttribute, ListingFee, MarketplaceOrderStatus, NormalizedClaim, NormalizedOrder,
  NormalizedShipment, PublishPayload, RemoteItem,
} from "../types";

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const toCents = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export function mapOrderStatus(s: string): MarketplaceOrderStatus {
  if (s === "paid") return "paid";
  if (s === "cancelled" || s === "invalid") return "cancelled";
  if (["payment_required", "payment_in_process", "partially_paid", "confirmed", "pending"].includes(s)) return "pending_payment";
  return "other";
}

/** Remove dados pessoais do payload antes de armazenar (LGPD). */
export function stripPersonalData(order: Any): Any {
  const clone = JSON.parse(JSON.stringify(order ?? {}));
  if (clone.buyer) clone.buyer = { id: clone.buyer.id, nickname: clone.buyer.nickname };
  delete clone.payments;
  delete clone.billing_info;
  return clone;
}

export function normalizeOrder(o: Any): NormalizedOrder {
  const items = (o.order_items ?? []).map((it: Any) => ({
    externalItemId: String(it.item?.id ?? ""),
    externalVariationId: it.item?.variation_id ? String(it.item.variation_id) : null,
    sellerSku: it.item?.seller_sku ?? it.item?.seller_custom_field ?? null,
    title: String(it.item?.title ?? "Item"),
    quantity: Number(it.quantity ?? 1),
    unitPriceCents: toCents(it.unit_price),
    saleFeeCents: toCents(it.sale_fee),
  }));
  const buyerName = [o.buyer?.first_name, o.buyer?.last_name].filter(Boolean).join(" ") || null;
  const paidPayment = (o.payments ?? []).find((p: Any) => p.status === "approved");
  return {
    externalOrderId: String(o.id),
    externalPackId: o.pack_id ? String(o.pack_id) : null,
    externalStatus: String(o.status ?? "unknown"),
    status: mapOrderStatus(String(o.status ?? "")),
    orderedAt: o.date_created ?? new Date().toISOString(),
    paidAt: paidPayment?.date_approved ?? (o.status === "paid" ? o.date_closed ?? o.date_created ?? null : null),
    totalCents: toCents(o.total_amount),
    currency: o.currency_id ?? "BRL",
    buyer: { nickname: o.buyer?.nickname ?? null, name: buyerName },
    shipmentId: o.shipping?.id ? String(o.shipping.id) : null,
    items,
    raw: stripPersonalData(o),
  };
}

export function shipmentStage(status: string, substatus?: string | null): NormalizedShipment["events"][number]["stage"] | null {
  switch (status) {
    case "ready_to_ship":
      return substatus === "dropped_off" || substatus === "picked_up" || substatus === "in_hub" ? "dispatched" : "preparing";
    case "shipped":
      return "in_transit";
    case "delivered":
      return "delivered";
    case "not_delivered":
      return "problem";
    case "cancelled":
      return "cancelled";
    default:
      return null; // pending, handling: ainda não há etapa logística
  }
}

const STAGE_TEXT: Record<string, string> = {
  preparing: "Etiqueta disponível / aguardando despacho",
  dispatched: "Pacote entregue à transportadora",
  in_transit: "Em trânsito",
  delivered: "Entregue ao comprador",
  cancelled: "Envio cancelado",
  problem: "Problema na entrega",
};

export function normalizeShipment(s: Any): NormalizedShipment {
  const status = String(s.status ?? "unknown");
  const substatus = s.substatus ?? null;
  const events: NormalizedShipment["events"] = [];
  const history: Any = s.status_history ?? {};
  const push = (stage: NormalizedShipment["events"][number]["stage"], at: string | undefined) => {
    if (at) events.push({ stage, occurredAt: at, description: STAGE_TEXT[stage] });
  };
  push("preparing", history.date_ready_to_ship);
  push("in_transit", history.date_shipped);
  push("delivered", history.date_delivered);
  push("problem", history.date_not_delivered);
  push("cancelled", history.date_cancelled);
  const current = shipmentStage(status, substatus);
  if (current && !events.some((e) => e.stage === current)) {
    events.push({ stage: current, occurredAt: s.last_updated ?? new Date().toISOString(), description: STAGE_TEXT[current] });
  }
  const sellerCost = s.cost_components?.seller ?? s.senders?.[0]?.cost ?? null;
  return {
    externalShipmentId: String(s.id),
    status,
    substatus,
    mode: s.logistic?.mode ?? s.mode ?? null,
    logisticType: s.logistic?.type ?? s.logistic_type ?? null,
    trackingNumber: s.tracking_number ?? null,
    trackingMethod: s.tracking_method ?? null,
    carrier: s.lead_time?.shipping_method?.name ?? s.shipping_option?.name ?? null,
    sellerCostCents: sellerCost !== null && sellerCost !== undefined ? toCents(sellerCost) : null,
    events,
  };
}

export function normalizeClaim(c: Any): NormalizedClaim {
  const type = String(c.type ?? "");
  const stage = String(c.stage ?? "");
  let t: NormalizedClaim["type"] = "claim";
  if (/return/.test(type)) t = "return";
  else if (/cancel/.test(type)) t = "cancellation";
  else if (stage === "dispute" || /mediation/.test(type)) t = "mediation";
  const dueDates: string[] = [];
  for (const p of c.players ?? []) {
    if (p.role === "respondent" || p.type === "seller") {
      for (const a of p.available_actions ?? []) if (a.due_date) dueDates.push(a.due_date);
    }
  }
  dueDates.sort();
  return {
    externalClaimId: String(c.id),
    externalOrderId: c.resource === "order" || c.resource_id ? String(c.resource_id ?? "") || null : null,
    type: t,
    reason: c.reason_id ?? c.reason ?? null,
    externalStatus: String(c.status ?? "unknown"),
    open: c.status !== "closed",
    openedAt: c.date_created ?? new Date().toISOString(),
    dueAt: dueDates[0] ?? null,
  };
}

export function buildItemBody(p: PublishPayload): Any {
  const attributes = [
    ...p.attributes.map((a) => ({ id: a.id, value_name: a.valueName })),
  ];
  if (!p.variations.length && !attributes.some((a) => a.id === "SELLER_SKU")) attributes.push({ id: "SELLER_SKU", value_name: p.sellerSku });
  const body: Any = {
    title: p.title.slice(0, 60),
    category_id: p.categoryId,
    price: p.priceCents / 100,
    currency_id: "BRL",
    available_quantity: p.quantity,
    buying_mode: "buy_it_now",
    listing_type_id: p.listingTypeId,
    condition: p.condition,
    pictures: p.pictureUrls.slice(0, 12).map((source) => ({ source })),
    attributes,
  };
  if (p.variations.length) {
    body.variations = p.variations.map((v) => ({
      attribute_combinations: v.attributes.map((a) => ({ id: a.id, value_name: a.valueName })),
      price: v.priceCents / 100,
      available_quantity: v.quantity,
      picture_ids: undefined,
      attributes: [{ id: "SELLER_SKU", value_name: v.sellerSku }],
    }));
    delete body.available_quantity;
  }
  return body;
}

export function normalizeItem(i: Any): RemoteItem {
  const skuAttr = (attrs: Any[] | undefined) => attrs?.find((a: Any) => a.id === "SELLER_SKU")?.value_name ?? null;
  return {
    externalId: String(i.id),
    title: String(i.title ?? ""),
    status: String(i.status ?? "unknown"),
    priceCents: toCents(i.price),
    availableQuantity: Number(i.available_quantity ?? 0),
    listingTypeId: i.listing_type_id ?? null,
    categoryId: i.category_id ?? null,
    permalink: i.permalink ?? null,
    sellerSku: i.seller_custom_field ?? skuAttr(i.attributes),
    variations: (i.variations ?? []).map((v: Any) => ({
      externalVariationId: String(v.id),
      sellerSku: v.seller_custom_field ?? skuAttr(v.attributes),
      availableQuantity: Number(v.available_quantity ?? 0),
    })),
  };
}

export function normalizeCategoryAttributes(list: Any[]): CategoryAttribute[] {
  return (list ?? []).map((a) => ({
    id: String(a.id),
    name: String(a.name ?? a.id),
    required: Boolean(a.tags?.required || a.tags?.catalog_required),
    valueType: String(a.value_type ?? "string"),
    values: (a.values ?? []).map((v: Any) => ({ id: String(v.id), name: String(v.name) })),
    allowVariations: Boolean(a.tags?.allow_variations),
  }));
}

export function parseListingFee(data: Any | Any[], listingTypeId: string): ListingFee {
  const entry = Array.isArray(data) ? data.find((d) => d.listing_type_id === listingTypeId) ?? data[0] : data;
  if (!entry || entry.sale_fee_amount === undefined) throw new Error("Resposta de taxas sem sale_fee_amount");
  const det = entry.sale_fee_details ?? {};
  return {
    saleFeeCents: toCents(entry.sale_fee_amount),
    percentageFee: det.percentage_fee !== undefined ? Number(det.percentage_fee) : null,
    fixedFeeCents: det.fixed_fee !== undefined ? toCents(det.fixed_fee) : null,
    listingTypeId: entry.listing_type_id ?? listingTypeId,
  };
}
