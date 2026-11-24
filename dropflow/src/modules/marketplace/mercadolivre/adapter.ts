import { env } from "@/lib/env";
import type { MarketplaceAdapter } from "../types";
import { mlRequest } from "./client";
import {
  buildItemBody, normalizeCategoryAttributes, normalizeClaim, normalizeItem, normalizeOrder,
  normalizeShipment, parseListingFee,
} from "./mappers";

/**
 * Adaptador da API OFICIAL do Mercado Livre.
 * Endpoints usados (conferir com a documentação vigente — docs/MERCADO_LIVRE.md):
 *   GET  /orders/{id}
 *   GET  /shipments/{id}                 (cabeçalho x-format-new: true)
 *   GET  /post-purchase/v1/claims/{id}
 *   POST /items  ·  POST /items/{id}/description  ·  PUT /items/{id}  ·  GET /items/{id}
 *   GET  /users/{id}/items/search
 *   GET  /sites/{site}/domain_discovery/search  ·  GET /categories/{id}/attributes
 *   GET  /sites/{site}/listing_prices
 */
export const mercadoLivreAdapter: MarketplaceAdapter = {
  id: "mercadolivre",

  async getOrder(acc, id) {
    return normalizeOrder(await mlRequest(acc.accountId, "GET", `/orders/${encodeURIComponent(id)}`));
  },

  async getShipment(acc, id) {
    return normalizeShipment(await mlRequest(acc.accountId, "GET", `/shipments/${encodeURIComponent(id)}`, { headers: { "x-format-new": "true" } }));
  },

  async getClaim(acc, id) {
    return normalizeClaim(await mlRequest(acc.accountId, "GET", `/post-purchase/v1/claims/${encodeURIComponent(id)}`));
  },

  async publishItem(acc, payload) {
    const created = await mlRequest<Record<string, any>>(acc.accountId, "POST", "/items", { body: buildItemBody(payload), retries: 0 }); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (payload.description) {
      try {
        await mlRequest(acc.accountId, "POST", `/items/${created.id}/description`, { body: { plain_text: payload.description.slice(0, 50000) } });
      } catch {
        /* o anúncio já existe; a descrição pode ser reenviada depois */
      }
    }
    const item = normalizeItem(created);
    return { externalId: item.externalId, status: item.status, permalink: item.permalink, variations: item.variations.map((v) => ({ externalVariationId: v.externalVariationId, sellerSku: v.sellerSku })) };
  },

  async updateItem(acc, id, u) {
    const body: Record<string, unknown> = {};
    if (u.variations?.length) {
      body.variations = u.variations.map((v) => ({
        id: Number(v.externalVariationId),
        ...(v.quantity !== undefined ? { available_quantity: v.quantity } : {}),
        ...(v.priceCents !== undefined ? { price: v.priceCents / 100 } : {}),
      }));
    } else {
      if (u.priceCents !== undefined) body.price = u.priceCents / 100;
      if (u.quantity !== undefined) body.available_quantity = u.quantity;
    }
    if (u.status) body.status = u.status;
    if (Object.keys(body).length) await mlRequest(acc.accountId, "PUT", `/items/${encodeURIComponent(id)}`, { body });
  },

  async getItem(acc, id) {
    return normalizeItem(await mlRequest(acc.accountId, "GET", `/items/${encodeURIComponent(id)}?include_attributes=all`));
  },

  async listItemIds(acc, offset, limit) {
    const r = await mlRequest<{ results: string[]; paging: { total: number } }>(
      acc.accountId, "GET", `/users/${acc.externalUserId}/items/search?offset=${offset}&limit=${limit}`,
    );
    return { ids: r.results ?? [], total: r.paging?.total ?? 0 };
  },

  async predictCategory(acc, title) {
    const r = await mlRequest<Record<string, string>[]>(
      acc.accountId, "GET", `/sites/${env().ML_SITE_ID}/domain_discovery/search?limit=5&q=${encodeURIComponent(title)}`,
    );
    return (r ?? []).map((x) => ({ categoryId: x.category_id, categoryName: x.category_name, domainName: x.domain_name }));
  },

  async getCategoryAttributes(acc, categoryId) {
    return normalizeCategoryAttributes(await mlRequest(acc.accountId, "GET", `/categories/${encodeURIComponent(categoryId)}/attributes`));
  },

  async getListingFee(acc, priceCents, listingTypeId, categoryId) {
    const qs = new URLSearchParams({ price: (priceCents / 100).toFixed(2), listing_type_id: listingTypeId, category_id: categoryId });
    return parseListingFee(await mlRequest(acc.accountId, "GET", `/sites/${env().ML_SITE_ID}/listing_prices?${qs}`), listingTypeId);
  },
};
