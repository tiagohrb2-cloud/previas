import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, query, queryOne } from "@/lib/db";
import { resetDatabase, setSetting } from "./helpers/db";
import { createUser } from "@/modules/auth/service";
import { createSupplier, saveIntegration, testIntegration, canAutoForward, getSupplier } from "@/modules/suppliers/service";
import { fetchSupplierCatalog, importStagedItems, importFileToCatalog } from "@/modules/catalog/service";
import { saveFeeProfile, savePricingRule } from "@/modules/pricing/service";
import { publishProduct, publishPreview } from "@/modules/listings/service";
import { simulateSale, simulateShipment, simulateClaim, simulateCancel } from "@/modules/simulator/service";
import { processQueue } from "@/modules/worker/handlers";
import { ingestNotification } from "@/modules/notifications/intake";
import { approveSupplierOrder, checkSupplierTimeout, manualSupplierStatus } from "@/modules/orders/processor";

let adminId: string;
let simSupplierId: string;

async function drain() {
  for (let i = 0; i < 10; i++) {
    const r = await processQueue(100);
    if (!r.done && !r.failed) break;
  }
  // tarefas agendadas para o futuro (timeouts) não são executadas aqui
}

async function orderByExternal(id: string) {
  return queryOne<{ id: string; code: string; status: string; problem_reason: string | null }>(
    "select id, code, status, problem_reason from orders where marketplace='simulated' and external_order_id=$1",
    [id],
  );
}

async function productBySku(supplierSku: string) {
  return queryOne<{ id: string }>("select id from products where supplier_sku = $1", [supplierSku]);
}

beforeAll(async () => {
  await resetDatabase();
  adminId = await createUser({ email: "admin@teste.com", name: "Admin", password: "SenhaForte123", role: "admin" }, null);
  simSupplierId = await createSupplier({ name: "Fornecedor Simulado", confirmation_timeout_hours: 24 }, adminId);
  await saveIntegration(simSupplierId, "simulated", {}, {}, adminId);
  const fee = await saveFeeProfile(null, { name: "Clássico (teste)", listing_type_id: "gold_special", commission_percent: 12, fixed_fee_tiers: [] }, adminId);
  await savePricingRule(null, { name: "Padrão", mode: "margin_fixed", value: 2000, fee_profile_id: fee, extra_cost_cents: 0, extra_cost_percent: 0, is_default: true }, adminId);
});

afterAll(async () => {
  await closePool();
});

describe("fluxo completo no modo teste", () => {
  it("testa a integração e importa o catálogo do fornecedor", async () => {
    const t = await testIntegration(simSupplierId, adminId);
    expect(t.ok).toBe(true);
    const staged = await fetchSupplierCatalog(simSupplierId, adminId);
    expect(staged.staged).toBeGreaterThanOrEqual(6);
    const imp = await importStagedItems(simSupplierId, "all", adminId);
    expect(imp.created).toBe(staged.staged);
    expect(imp.errors).toEqual([]);
    const cam = await queryOne<{ n: string }>(
      "select count(*) as n from product_variants v join products p on p.id = v.product_id where p.supplier_sku = 'SIM-CAMISETA'",
    );
    expect(Number(cam!.n)).toBe(3);
    // reimportar não duplica
    const again = await importStagedItems(simSupplierId, "all", adminId);
    expect(again.created).toBe(0);
    expect(again.updated).toBe(staged.staged);
  });

  it("calcula preço e lucro antes de publicar e publica no marketplace simulado", async () => {
    const p = (await productBySku("SIM-FONE-01"))!;
    const preview = await publishPreview({ productId: p.id, categoryId: "SIM-CAT", listingTypeId: "gold_special" });
    expect(preview.pricing.result.netProfitCents).toBeGreaterThanOrEqual(2000);
    expect(preview.totalStock).toBe(40);
    await expect(
      publishProduct({ productId: p.id, categoryId: "SIM-CAT", listingTypeId: "gold_special", attributes: [] }, adminId),
    ).rejects.toThrow(/Modelo/); // atributo obrigatório da categoria
    const r = await publishProduct({ productId: p.id, categoryId: "SIM-CAT", listingTypeId: "gold_special", attributes: [{ id: "MODEL", valueName: "TWS-01" }] }, adminId);
    expect(r.externalId).toMatch(/^SIM/);
    await expect(
      publishProduct({ productId: p.id, categoryId: "SIM-CAT", listingTypeId: "gold_special", attributes: [{ id: "MODEL", valueName: "TWS-01" }] }, adminId),
    ).rejects.toThrow(/já possui/);
  });

  it("sem automação: pedido aguarda aprovação; após aprovar, fornecedor simulado confirma", async () => {
    await setSetting("auto_forward_orders_enabled", false);
    const listing = (await queryOne<{ id: string }>("select id from listings where marketplace='simulated' limit 1"))!;
    const ext = await simulateSale({ listingId: listing.id, quantity: 2 }, adminId);
    await drain();
    const o = (await orderByExternal(ext))!;
    expect(o.status).toBe("awaiting_forward");
    const so = (await queryOne<{ id: string; status: string }>("select id, status from supplier_orders where order_id=$1", [o.id]))!;
    expect(so.status).toBe("awaiting_approval");
    const inv = await queryOne<{ reserved: number }>("select i.reserved from inventory i join product_variants v on v.id=i.variant_id join products p on p.id=v.product_id where p.supplier_sku='SIM-FONE-01'");
    expect(inv!.reserved).toBe(2);
    await approveSupplierOrder(so.id, adminId);
    await drain();
    expect((await orderByExternal(ext))!.status).toBe("supplier_confirmed");
    const after = await queryOne<{ quantity: number; reserved: number }>("select i.quantity, i.reserved from inventory i join product_variants v on v.id=i.variant_id join products p on p.id=v.product_id where p.supplier_sku='SIM-FONE-01'");
    expect(after).toEqual({ quantity: 38, reserved: 0 });
  });

  it("com automação: encaminha sozinho, rastreia pelo marketplace e entrega", async () => {
    await setSetting("auto_forward_orders_enabled", true);
    const listing = (await queryOne<{ id: string }>("select id from listings where marketplace='simulated' limit 1"))!;
    const ext = await simulateSale({ listingId: listing.id, quantity: 1 }, adminId);
    await drain();
    const o = (await orderByExternal(ext))!;
    expect(o.status).toBe("supplier_confirmed");
    const shipId = `4${ext}`;
    await simulateShipment(shipId, "ready_to_ship", adminId);
    await drain();
    await simulateShipment(shipId, "dropped_off", adminId);
    await drain();
    expect((await orderByExternal(ext))!.status).toBe("dispatched");
    await simulateShipment(shipId, "shipped", adminId);
    await drain();
    expect((await orderByExternal(ext))!.status).toBe("in_transit");
    const ship = await queryOne<{ tracking_number: string }>("select tracking_number from shipments where order_id=$1", [o.id]);
    expect(ship!.tracking_number).toMatch(/^SIMRASTREIO/);
    await simulateShipment(shipId, "delivered", adminId);
    await drain();
    expect((await orderByExternal(ext))!.status).toBe("delivered");
    const stages = await query<{ stage: string }>("select distinct stage from tracking_events where order_id=$1", [o.id]);
    expect(stages.map((s) => s.stage).sort()).toEqual(["confirmed", "delivered", "dispatched", "forwarded", "in_transit", "preparing", "received"].sort());

    // devolução
    await simulateClaim(ext, "return", adminId);
    await drain();
    const claim = await queryOne<{ id: string; type: string; status: string }>("select id, type, status from claims where order_id=$1", [o.id]);
    expect(claim).toMatchObject({ type: "return", status: "open" });
    const ret = await queryOne<{ status: string }>("select status from returns where order_id=$1", [o.id]);
    expect(ret!.status).toBe("requested");
    const alert = await queryOne("select 1 from alerts where dedupe_key=$1 and resolved_at is null", [`claim:${claim!.id}`]);
    expect(alert).toBeTruthy();
  });

  it("notificação duplicada não gera pedido duplicado", async () => {
    const listing = (await queryOne<{ id: string }>("select id from listings where marketplace='simulated' limit 1"))!;
    const ext = await simulateSale({ listingId: listing.id, quantity: 1 }, adminId);
    const payload = { _id: "dup-1", resource: `/orders/${ext}`, user_id: "SIMULATED", topic: "orders_v2" };
    expect((await ingestNotification(payload, "simulated")).status).toBe("queued");
    expect((await ingestNotification(payload, "simulated")).status).toBe("duplicate");
    await drain();
    await ingestNotification({ ...payload, _id: "dup-2" }, "simulated");
    await drain();
    const n = await queryOne<{ n: string }>("select count(*) as n from orders where external_order_id=$1", [ext]);
    expect(Number(n!.n)).toBe(1);
    const so = await queryOne<{ n: string }>("select count(*) as n from supplier_orders so join orders o on o.id=so.order_id where o.external_order_id=$1", [ext]);
    expect(Number(so!.n)).toBe(1);
  });

  it("sem estoque: não encaminha e gera alerta", async () => {
    const p = (await productBySku("SIM-LUMI-LED"))!; // 12 unidades
    const r = await publishProduct({ productId: p.id, categoryId: "SIM-CAT", listingTypeId: "gold_special", attributes: [{ id: "MODEL", valueName: "L1" }] }, adminId);
    const listing = (await queryOne<{ id: string }>("select id from listings where external_id=$1", [r.externalId]))!;
    const ext = await simulateSale({ listingId: listing.id, quantity: 50 }, adminId);
    await drain();
    const o = (await orderByExternal(ext))!;
    expect(o.status).toBe("problem");
    expect(o.problem_reason).toBe("out_of_stock");
    const so = await queryOne("select 1 from supplier_orders where order_id=$1", [o.id]);
    expect(so).toBeNull();
    const alert = await queryOne<{ severity: string }>("select severity from alerts where dedupe_key=$1", [`out_of_stock:${o.id}`]);
    expect(alert!.severity).toBe("critical");
  });

  it("cancelamento após encaminhamento alerta para cancelar no fornecedor", async () => {
    const listing = (await queryOne<{ id: string }>("select id from listings where marketplace='simulated' and title like 'Fone%'"))!;
    const ext = await simulateSale({ listingId: listing.id, quantity: 1 }, adminId);
    await drain();
    await simulateCancel(ext, adminId);
    await drain();
    const o = (await orderByExternal(ext))!;
    expect(o.status).toBe("cancelled");
    expect(await queryOne("select 1 from alerts where dedupe_key=$1", [`cancelled_after_forward:${o.id}`])).toBeTruthy();
  });

  it("variações: venda de uma variação específica é vinculada à variação correta", async () => {
    const p = (await productBySku("SIM-CAMISETA"))!;
    const r = await publishProduct({ productId: p.id, categoryId: "SIM-CAT", listingTypeId: "gold_special", attributes: [{ id: "MODEL", valueName: "DRY" }] }, adminId);
    const lv = (await queryOne<{ external_variation_id: string; listing_id: string }>(
      "select lv.external_variation_id, lv.listing_id from listing_variations lv join listings l on l.id=lv.listing_id where l.external_id=$1 and lv.seller_sku like '%PRETA-G'",
      [r.externalId],
    ))!;
    const ext = await simulateSale({ listingId: lv.listing_id, variationExternalId: lv.external_variation_id, quantity: 1 }, adminId);
    await drain();
    const item = await queryOne<{ supplier_sku: string }>(
      "select v.supplier_sku from order_items oi join orders o on o.id=oi.order_id join product_variants v on v.id=oi.variant_id where o.external_order_id=$1",
      [ext],
    );
    expect(item!.supplier_sku).toBe("SIM-CAMISETA-PRETA-G");
  });
});

describe("fornecedor manual", () => {
  it("gera pedido para envio manual, alerta por falta de confirmação e aceita confirmação do operador", async () => {
    const manualId = await createSupplier({ name: "Distribuidora Manual", confirmation_timeout_hours: 1 }, adminId);
    const csv = "sku;nome;preco_custo;estoque;imagem\nMAN-1;Caneca Cerâmica 350ml;12,50;20;https://exemplo.com/caneca.jpg\n";
    await importFileToCatalog(manualId, "c.csv", new TextEncoder().encode(csv).buffer as ArrayBuffer, {}, adminId);
    await importStagedItems(manualId, "all", adminId);
    const supplier = (await getSupplier(manualId))!;
    expect(canAutoForward(supplier, "test").ok).toBe(false);

    const p = (await productBySku("MAN-1"))!;
    const r = await publishProduct({ productId: p.id, categoryId: "SIM-CAT", listingTypeId: "gold_special", attributes: [{ id: "MODEL", valueName: "C" }, { id: "BRAND", valueName: "Genérica" }] }, adminId);
    const listing = (await queryOne<{ id: string }>("select id from listings where external_id=$1", [r.externalId]))!;
    const ext = await simulateSale({ listingId: listing.id, quantity: 1 }, adminId);
    await drain();
    const o = (await orderByExternal(ext))!;
    expect(o.status).toBe("awaiting_forward"); // automação ligada, mas fornecedor sem API => aprovação manual
    const so = (await queryOne<{ id: string }>("select id from supplier_orders where order_id=$1", [o.id]))!;
    await approveSupplierOrder(so.id, adminId);
    await drain();
    const sent = (await queryOne<{ status: string; message: string }>("select status, message from supplier_orders where id=$1", [so.id]))!;
    expect(sent.status).toBe("manual_required");
    expect(sent.message).toMatch(/etiqueta|Envio simulado/i);
    expect((await orderByExternal(ext))!.status).toBe("forwarded");

    await query("update supplier_orders set confirmation_due_at = now() - interval '1 minute' where id=$1", [so.id]);
    await checkSupplierTimeout(so.id);
    expect((await orderByExternal(ext))!.problem_reason).toBe("supplier_timeout");

    await manualSupplierStatus(so.id, "confirmed", adminId);
    const after = (await orderByExternal(ext))!;
    expect(after.status).toBe("supplier_confirmed");
    expect(after.problem_reason).toBeNull();
    await expect(manualSupplierStatus(so.id, "submitted", adminId)).rejects.toThrow(/Transição inválida/);

    // fornecedor informa despacho, mas não define rastreio: o código vem do marketplace
    await manualSupplierStatus(so.id, "dispatched", adminId);
    const ship = await queryOne<{ tracking_number: string | null }>("select tracking_number from shipments where order_id=$1", [o.id]);
    expect(ship?.tracking_number ?? null).toBeNull();
  });
});
