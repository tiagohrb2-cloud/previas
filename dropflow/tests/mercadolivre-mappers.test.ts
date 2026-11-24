import { describe, expect, it } from "vitest";
import { buildItemBody, normalizeClaim, normalizeItem, normalizeOrder, normalizeShipment, parseListingFee, shipmentStage, stripPersonalData } from "@/modules/marketplace/mercadolivre/mappers";
import { resourceId } from "@/modules/notifications/intake";

describe("conversores da API do Mercado Livre", () => {
  const order = {
    id: 2000001234, status: "paid", date_created: "2026-11-20T10:00:00.000-03:00", pack_id: null, total_amount: 119.9, currency_id: "BRL",
    order_items: [{ item: { id: "MLB123", title: "Fone", variation_id: 555, seller_sku: "ABCD-FONE" }, quantity: 1, unit_price: 119.9, sale_fee: 14.39 }],
    buyer: { id: 9, nickname: "COMPRADOR", first_name: "Maria", last_name: "Silva" },
    shipping: { id: 4001 },
    payments: [{ status: "approved", date_approved: "2026-11-20T10:01:00.000-03:00", card_number: "x" }],
  };

  it("normaliza pedido e remove dados pessoais do payload armazenado", () => {
    const o = normalizeOrder(order);
    expect(o).toMatchObject({ externalOrderId: "2000001234", status: "paid", totalCents: 11990, shipmentId: "4001" });
    expect(o.items[0]).toMatchObject({ externalVariationId: "555", sellerSku: "ABCD-FONE", saleFeeCents: 1439 });
    expect(o.buyer.name).toBe("Maria Silva");
    const raw = stripPersonalData(order) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(raw.buyer).toEqual({ id: 9, nickname: "COMPRADOR" });
    expect(raw.payments).toBeUndefined();
  });

  it("mapeia status de envio para etapas de rastreamento", () => {
    expect(shipmentStage("ready_to_ship", "ready_to_print")).toBe("preparing");
    expect(shipmentStage("ready_to_ship", "dropped_off")).toBe("dispatched");
    expect(shipmentStage("shipped")).toBe("in_transit");
    expect(shipmentStage("delivered")).toBe("delivered");
    expect(shipmentStage("handling")).toBeNull();
    const s = normalizeShipment({ id: 4001, status: "shipped", tracking_number: "BR123", logistic: { mode: "me2", type: "drop_off" }, status_history: { date_shipped: "2026-11-21T10:00:00Z" } });
    expect(s).toMatchObject({ trackingNumber: "BR123", mode: "me2", logisticType: "drop_off" });
    expect(s.events.map((e) => e.stage)).toEqual(["in_transit"]);
  });

  it("normaliza reclamação com prazo do vendedor", () => {
    const c = normalizeClaim({ id: 77, resource_id: 2000001234, resource: "order", type: "mediations", stage: "claim", status: "opened", reason_id: "PDD9549",
      players: [{ role: "respondent", available_actions: [{ action: "send_message", due_date: "2026-11-25T10:00:00Z" }, { action: "refund", due_date: "2026-11-24T10:00:00Z" }] }] });
    expect(c).toMatchObject({ externalClaimId: "77", externalOrderId: "2000001234", open: true, dueAt: "2026-11-24T10:00:00Z" });
  });

  it("monta o corpo de publicação com SKU por variação", () => {
    const body = buildItemBody({
      title: "Camiseta Dry Fit Masculina Esportiva Tecido Leve Secagem Rápida Extra Longo",
      categoryId: "MLB1", listingTypeId: "gold_special", condition: "new", priceCents: 5990, quantity: 10, description: "d",
      pictureUrls: ["https://x/1.jpg"], attributes: [{ id: "BRAND", valueName: "X" }], sellerSku: "P1",
      variations: [{ variantId: "v", sellerSku: "P1-M", attributes: [{ id: "SIZE", valueName: "M" }], quantity: 4, priceCents: 5990, pictureUrls: [] }],
    });
    expect(body.title.length).toBeLessThanOrEqual(60);
    expect(body.price).toBe(59.9);
    expect(body.available_quantity).toBeUndefined();
    expect(body.variations[0].attributes).toEqual([{ id: "SELLER_SKU", value_name: "P1-M" }]);
  });

  it("lê anúncio e taxas oficiais", () => {
    const i = normalizeItem({ id: "MLB9", title: "T", status: "active", price: 10, available_quantity: 3, attributes: [{ id: "SELLER_SKU", value_name: "S1" }], variations: [] });
    expect(i.sellerSku).toBe("S1");
    const f = parseListingFee([{ listing_type_id: "gold_pro", sale_fee_amount: 20 }, { listing_type_id: "gold_special", sale_fee_amount: 14.39, sale_fee_details: { percentage_fee: 12, fixed_fee: 0 } }], "gold_special");
    expect(f).toMatchObject({ saleFeeCents: 1439, percentageFee: 12 });
  });

  it("extrai o ID do recurso da notificação", () => {
    expect(resourceId("/orders/2000001234")).toBe("2000001234");
    expect(resourceId("/items/MLB123456")).toBe("MLB123456");
    expect(resourceId("/post-purchase/v1/claims/5001")).toBe("5001");
  });
});
