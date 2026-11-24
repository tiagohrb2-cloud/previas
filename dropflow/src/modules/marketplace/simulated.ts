import { query, queryOne } from "@/lib/db";
import { MarketplaceError, type MarketplaceAdapter, type NormalizedClaim, type NormalizedOrder, type NormalizedShipment } from "./types";

/**
 * Marketplace SIMULADO — usado somente no MODO TESTE.
 * Guarda anúncios, pedidos, envios e reclamações fictícios em simulation_store,
 * para exercitar o mesmo fluxo de processamento usado em produção.
 */
async function load<T>(kind: string, id: string): Promise<T> {
  const r = await queryOne<{ data: T }>("select data from simulation_store where kind = $1 and external_id = $2", [kind, id]);
  if (!r) throw new MarketplaceError(`Recurso simulado não encontrado: ${kind}/${id}`, 404);
  return r.data;
}

export async function saveSim(kind: string, id: string, data: unknown) {
  await query(
    `insert into simulation_store(kind, external_id, data, updated_at) values ($1,$2,$3, now())
     on conflict (kind, external_id) do update set data = excluded.data, updated_at = now()`,
    [kind, id, JSON.stringify(data)],
  );
}

interface SimItem {
  externalId: string; title: string; status: string; priceCents: number; availableQuantity: number;
  listingTypeId: string; categoryId: string; sellerSku: string;
  variations: { externalVariationId: string; sellerSku: string; availableQuantity: number }[];
}

export const simulatedMarketplace: MarketplaceAdapter = {
  id: "simulated",
  getOrder: (_a, id) => load<NormalizedOrder>("order", id),
  getShipment: (_a, id) => load<NormalizedShipment>("shipment", id),
  getClaim: (_a, id) => load<NormalizedClaim>("claim", id),

  async publishItem(_a, p) {
    const n = await queryOne<{ n: string }>("select count(*) as n from simulation_store where kind = 'item'");
    const externalId = `SIM${String(1000000 + Number(n?.n ?? 0) + 1)}`;
    const item: SimItem = {
      externalId,
      title: p.title,
      status: "active",
      priceCents: p.priceCents,
      availableQuantity: p.variations.length ? p.variations.reduce((s, v) => s + v.quantity, 0) : p.quantity,
      listingTypeId: p.listingTypeId,
      categoryId: p.categoryId,
      sellerSku: p.sellerSku,
      variations: p.variations.map((v, i) => ({ externalVariationId: `${externalId}V${i + 1}`, sellerSku: v.sellerSku, availableQuantity: v.quantity })),
    };
    await saveSim("item", externalId, item);
    return { externalId, status: "active", permalink: null, variations: item.variations.map((v) => ({ externalVariationId: v.externalVariationId, sellerSku: v.sellerSku })) };
  },

  async updateItem(_a, id, u) {
    const item = await load<SimItem>("item", id);
    if (u.priceCents !== undefined) item.priceCents = u.priceCents;
    if (u.quantity !== undefined) item.availableQuantity = u.quantity;
    if (u.status) item.status = u.status;
    for (const v of u.variations ?? []) {
      const iv = item.variations.find((x) => x.externalVariationId === v.externalVariationId);
      if (iv && v.quantity !== undefined) iv.availableQuantity = v.quantity;
      if (v.priceCents !== undefined) item.priceCents = v.priceCents;
    }
    if (item.variations.length) item.availableQuantity = item.variations.reduce((s, v) => s + v.availableQuantity, 0);
    await saveSim("item", id, item);
  },

  async getItem(_a, id) {
    const i = await load<SimItem>("item", id);
    return { ...i, permalink: null };
  },

  async listItemIds(_a, offset, limit) {
    const rows = await query<{ external_id: string }>("select external_id from simulation_store where kind='item' order by external_id offset $1 limit $2", [offset, limit]);
    const total = await queryOne<{ n: string }>("select count(*) as n from simulation_store where kind='item'");
    return { ids: rows.map((r) => r.external_id), total: Number(total?.n ?? 0) };
  },

  async predictCategory() {
    return [{ categoryId: "SIM-CAT", categoryName: "Categoria simulada", domainName: "SIMULADO" }];
  },

  async getCategoryAttributes() {
    return [
      { id: "BRAND", name: "Marca", required: true, valueType: "string", values: [], allowVariations: false },
      { id: "MODEL", name: "Modelo", required: true, valueType: "string", values: [], allowVariations: false },
      { id: "COLOR", name: "Cor", required: false, valueType: "string", values: [], allowVariations: true },
      { id: "SIZE", name: "Tamanho", required: false, valueType: "string", values: [], allowVariations: true },
    ];
  },
};
