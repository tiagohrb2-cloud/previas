import { query, queryOne } from "@/lib/db";
import type { NormalizedProduct } from "@/modules/catalog/types";
import { SupplierIntegrationError, type SupplierAdapter, type SupplierContext } from "./types";

/**
 * Fornecedor SIMULADO — disponível apenas no MODO TESTE.
 * Gera um catálogo de demonstração e responde pedidos como um fornecedor faria,
 * para testar o fluxo completo sem tocar em integrações reais.
 */
function guard(ctx: SupplierContext) {
  if (ctx.mode !== "test") throw new SupplierIntegrationError("Fornecedor simulado só funciona no modo teste.", false);
}

const BASE: Omit<NormalizedProduct, "description" | "attributes" | "variants" | "images">[] = [
  { supplierSku: "SIM-FONE-01", title: "Fone de Ouvido Bluetooth TWS com Estojo", brand: "SimSound", costCents: 4590, weightG: 180, lengthCm: 12, widthCm: 9, heightCm: 5, stock: 40 },
  { supplierSku: "SIM-GARRAFA-500", title: "Garrafa Térmica Inox 500 ml Parede Dupla", brand: "SimHome", costCents: 3290, weightG: 420, lengthCm: 26, widthCm: 8, heightCm: 8, stock: 25 },
  { supplierSku: "SIM-LUMI-LED", title: "Luminária de Mesa LED Recarregável", brand: "SimLight", costCents: 5490, weightG: 650, lengthCm: 30, widthCm: 15, heightCm: 12, stock: 12 },
  { supplierSku: "SIM-ORG-GAV", title: "Organizador de Gaveta Modular 6 Peças", brand: "SimHome", costCents: 2190, weightG: 300, lengthCm: 32, widthCm: 22, heightCm: 6, stock: 0 },
  { supplierSku: "SIM-MOCHILA", title: "Mochila Executiva Impermeável para Notebook 15,6\"", brand: "SimBag", costCents: 8900, weightG: 900, lengthCm: 45, widthCm: 32, heightCm: 12, stock: 8 },
];

export function simulatedCatalog(): NormalizedProduct[] {
  const products: NormalizedProduct[] = BASE.map((p, i) => ({
    ...p,
    description: `${p.title}. Produto de demonstração do fornecedor simulado (modo teste).`,
    images: [`https://placehold.co/800x800/png?text=${encodeURIComponent(p.supplierSku)}`],
    attributes: { Material: i % 2 ? "Inox" : "Plástico ABS", Garantia: "90 dias" },
    gtin: undefined,
    variants: [],
  }));
  products.push({
    supplierSku: "SIM-CAMISETA",
    title: "Camiseta Dry Fit Masculina Esportiva",
    description: "Camiseta de tecido leve, secagem rápida. Produto de demonstração (modo teste).",
    brand: "SimFit",
    costCents: 2490,
    weightG: 160,
    lengthCm: 30, widthCm: 25, heightCm: 2,
    images: ["https://placehold.co/800x800/png?text=SIM-CAMISETA"],
    attributes: { Material: "Poliéster" },
    variants: [
      { supplierSku: "SIM-CAMISETA-PRETA-M", attributes: { Cor: "Preta", Tamanho: "M" }, stock: 15 },
      { supplierSku: "SIM-CAMISETA-PRETA-G", attributes: { Cor: "Preta", Tamanho: "G" }, stock: 6 },
      { supplierSku: "SIM-CAMISETA-AZUL-M", attributes: { Cor: "Azul", Tamanho: "M" }, stock: 0 },
    ],
  });
  return products;
}

async function stockOverrides(): Promise<Record<string, number>> {
  const rows = await query<{ external_id: string; data: { stock: number } }>("select external_id, data from simulation_store where kind = 'supplier_stock'");
  return Object.fromEntries(rows.map((r) => [r.external_id, r.data.stock]));
}

export const simulatedAdapter: SupplierAdapter = {
  type: "simulated",
  label: "Simulado (somente modo teste)",
  description: "Fornecedor fictício para testar importação, estoque, pedidos e rastreamento. Bloqueado no modo produção.",
  capabilities: { catalog: true, stock: true, submitOrder: true, orderStatus: true },

  async testConnection(ctx) {
    guard(ctx);
    return { ok: true, message: "Fornecedor simulado disponível (modo teste)." };
  },

  async fetchCatalog(ctx) {
    guard(ctx);
    const overrides = await stockOverrides();
    const products = simulatedCatalog().map((p) => ({
      ...p,
      stock: p.stock !== undefined ? overrides[p.supplierSku] ?? p.stock : undefined,
      variants: p.variants.map((v) => ({ ...v, stock: overrides[v.supplierSku] ?? v.stock })),
    }));
    return { products, nextCursor: null };
  },

  async fetchStock(ctx, skus) {
    guard(ctx);
    const overrides = await stockOverrides();
    const all: Record<string, number> = {};
    for (const p of simulatedCatalog()) {
      if (p.stock !== undefined) all[p.supplierSku] = p.stock;
      for (const v of p.variants) all[v.supplierSku] = v.stock ?? 0;
    }
    return Object.fromEntries(skus.map((s) => [s, overrides[s] ?? all[s] ?? 0]));
  },

  async submitOrder(ctx, order) {
    guard(ctx);
    const existing = await queryOne<{ data: { ref: string; status: string } }>(
      "select data from simulation_store where kind = 'supplier_order' and external_id = $1",
      [order.idempotencyKey],
    );
    if (existing) return { status: existing.data.status as "confirmed", externalReference: existing.data.ref };
    const ref = `SIMFORN-${order.orderCode}`;
    await query(
      "insert into simulation_store(kind, external_id, data) values ('supplier_order', $1, $2) on conflict do nothing",
      [order.idempotencyKey, JSON.stringify({ ref, status: "confirmed", items: order.items })],
    );
    return { status: "confirmed", externalReference: ref };
  },

  async getOrderStatus(ctx, externalReference) {
    guard(ctx);
    const row = await queryOne<{ data: { status: string } }>(
      "select data from simulation_store where kind = 'supplier_order' and data->>'ref' = $1",
      [externalReference],
    );
    if (!row) throw new SupplierIntegrationError("Pedido simulado não encontrado", false);
    return { status: row.data.status as "confirmed", externalReference };
  },
};
