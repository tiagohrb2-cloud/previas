import { query, queryOne, tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { raiseAlert } from "@/lib/alerts";
import { getSettings } from "@/lib/settings";
import { activeMarketplaceContext, marketplaceContextFor } from "@/modules/marketplace/registry";
import { MarketplaceError, type MarketplaceId, type PublishPayload } from "@/modules/marketplace/types";
import { sellableStock } from "@/modules/catalog/service";
import { calculatePrice } from "@/modules/pricing/calculator";
import { priceProduct, toTiers, type FeeProfileRow } from "@/modules/pricing/service";

/** Mapeamento dos nomes de variação do DropFlow para atributos do Mercado Livre. */
const VARIATION_ATTRIBUTE_IDS: Record<string, string> = { Cor: "COLOR", Tamanho: "SIZE" };

export interface PublishInput {
  productId: string;
  categoryId: string;
  listingTypeId: string;
  pricingRuleId?: string | null;
  priceCents?: number | null; // preço definido manualmente (sobrepõe a regra)
  title?: string;
  attributes: { id: string; valueName: string }[]; // atributos da categoria preenchidos pelo usuário
}

async function loadProductForPublish(productId: string) {
  const p = await queryOne<{ id: string; sku: string; title: string; description: string; brand: string | null; gtin: string | null; condition: "new" | "used"; status: string }>(
    "select id, sku, title, description, brand, gtin, condition, status from products where id = $1",
    [productId],
  );
  if (!p) throw new Error("Produto não encontrado");
  const images = await query<{ url: string }>("select url from product_images where product_id = $1 order by position", [productId]);
  const variants = await query<{ id: string; sku: string; attributes: Record<string, string>; is_default: boolean; quantity: number; reserved: number; gtin: string | null }>(
    `select v.id, v.sku, v.attributes, v.is_default, v.gtin, coalesce(i.quantity,0) as quantity, coalesce(i.reserved,0) as reserved
     from product_variants v left join inventory i on i.variant_id = v.id where v.product_id = $1 and v.active order by v.sku`,
    [productId],
  );
  return { p, images: images.map((i) => i.url), variants };
}

/** Pré-visualização: preço, lucro, estoque e pendências antes de publicar. */
export async function publishPreview(input: Omit<PublishInput, "attributes"> & { attributes?: PublishInput["attributes"] }) {
  const { p, images, variants } = await loadProductForPublish(input.productId);
  const settings = await getSettings();
  const pricing = await priceProduct(p.id, input.pricingRuleId);
  let result = pricing.result;
  if (input.priceCents) {
    const fee = pricing.feeProfile ? await queryOne<FeeProfileRow>("select * from fee_profiles where id = $1", [pricing.feeProfile.id]) : null;
    const rule = pricing.rule ? await queryOne<{ extra_cost_cents: string; extra_cost_percent: string }>("select extra_cost_cents, extra_cost_percent from pricing_rules where id=$1", [pricing.rule.id]) : null;
    const prod = await queryOne<{ seller_shipping_cost_cents: string }>("select seller_shipping_cost_cents from products where id=$1", [p.id]);
    result = calculatePrice({
      costCents: pricing.costCents,
      sellerShippingCents: Number(prod?.seller_shipping_cost_cents ?? 0),
      extraCostCents: Number(rule?.extra_cost_cents ?? 0),
      extraCostPercent: Number(rule?.extra_cost_percent ?? 0),
      fee: { commissionPercent: Number(fee?.commission_percent ?? 0), fixedFeeTiers: fee ? toTiers(fee.fixed_fee_tiers) : [] },
      mode: "fixed_price",
      value: input.priceCents,
    });
  }
  const multiVariant = variants.some((v) => !v.is_default);
  const stock = variants.map((v) => ({ ...v, sellable: sellableStock(v.quantity, v.reserved, settings.stock_safety_margin) }));
  const totalStock = stock.reduce((s, v) => s + v.sellable, 0);
  const issues: string[] = [];
  if (!images.length) issues.push("O produto não tem fotos.");
  if (!input.categoryId) issues.push("Escolha a categoria do Mercado Livre.");
  if (totalStock <= 0) issues.push("Sem estoque disponível no fornecedor.");
  if (result.netProfitCents <= 0) issues.push("O preço não gera lucro.");
  if (pricing.feeProfile && pricing.feeProfile.listing_type_id !== input.listingTypeId) {
    issues.push(`O perfil de taxas "${pricing.feeProfile.name}" é de outro tipo de anúncio (${pricing.feeProfile.listing_type_id}).`);
  }
  if (!pricing.feeProfile) issues.push("Sem perfil de taxas: o lucro exibido não considera a comissão do marketplace.");
  return { product: p, images, variants: stock, multiVariant, totalStock, pricing: { ...pricing, result }, issues };
}

/** Publica um produto. Só é chamado por ação do usuário ou pela publicação automática autorizada. */
export async function publishProduct(input: PublishInput, userId: string | null) {
  const preview = await publishPreview(input);
  const blocking = preview.issues.filter((i) => !i.startsWith("Sem perfil de taxas") && !i.startsWith("O perfil de taxas"));
  if (blocking.length) throw new Error(blocking.join(" "));

  const { adapter, account } = await activeMarketplaceContext();
  // atributos obrigatórios da categoria
  if (adapter.getCategoryAttributes) {
    const attrs = await adapter.getCategoryAttributes(account, input.categoryId);
    const provided = new Map(input.attributes.filter((a) => a.valueName.trim()).map((a) => [a.id, a.valueName.trim()]));
    if (preview.product.brand && !provided.has("BRAND")) provided.set("BRAND", preview.product.brand);
    if (preview.product.gtin && !provided.has("GTIN")) provided.set("GTIN", preview.product.gtin);
    const variationAttrs = new Set(preview.multiVariant ? Object.values(VARIATION_ATTRIBUTE_IDS) : []);
    const missing = attrs.filter((a) => a.required && !provided.has(a.id) && !variationAttrs.has(a.id));
    if (missing.length) throw new Error(`Preencha os atributos obrigatórios da categoria: ${missing.map((m) => m.name).join(", ")}.`);
    input.attributes = [...provided].map(([id, valueName]) => ({ id, valueName }));
  }

  const marketplace: MarketplaceId = adapter.id;
  const existing = await queryOne(
    "select 1 from listings where product_id = $1 and marketplace = $2 and status in ('pending','active','paused','under_review')",
    [input.productId, marketplace],
  );
  if (existing) throw new Error("Este produto já possui um anúncio ativo neste marketplace.");

  const price = preview.pricing.result.priceCents;
  const listing = await queryOne<{ id: string }>(
    `insert into listings(marketplace, account_id, product_id, title, status, price_cents, available_quantity, listing_type_id, category_id, pricing_snapshot)
     values ($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9) returning id`,
    [marketplace, account.accountId, input.productId, (input.title || preview.product.title).slice(0, 60), price, preview.totalStock, input.listingTypeId, input.categoryId,
     JSON.stringify({ ...preview.pricing.result, ruleId: preview.pricing.rule?.id ?? null, feeProfileId: preview.pricing.feeProfile?.id ?? null, manualPrice: Boolean(input.priceCents) })],
  );
  const payload: PublishPayload = {
    title: input.title || preview.product.title,
    categoryId: input.categoryId,
    listingTypeId: input.listingTypeId,
    condition: preview.product.condition,
    priceCents: price,
    quantity: preview.totalStock,
    description: preview.product.description,
    pictureUrls: preview.images,
    attributes: input.attributes,
    sellerSku: preview.product.sku,
    variations: preview.multiVariant
      ? preview.variants.map((v) => ({
          variantId: v.id,
          sellerSku: v.sku,
          attributes: Object.entries(v.attributes).map(([k, val]) => ({ id: VARIATION_ATTRIBUTE_IDS[k] ?? k.toUpperCase(), valueName: val })),
          quantity: v.sellable,
          priceCents: price,
          pictureUrls: [],
        }))
      : [],
  };
  try {
    const published = await adapter.publishItem(account, payload);
    await tx(async (c) => {
      await query(
        "update listings set external_id=$2, status=$3, permalink=$4, last_synced_at=now(), sync_error=null where id=$1",
        [listing!.id, published.externalId, normalizeListingStatus(published.status), published.permalink],
        c,
      );
      const defaultVariant = preview.variants.find((v) => v.is_default);
      if (published.variations.length) {
        for (const pv of published.variations) {
          const v = preview.variants.find((x) => x.sku === pv.sellerSku);
          await query("insert into listing_variations(listing_id, variant_id, external_variation_id, seller_sku) values ($1,$2,$3,$4) on conflict do nothing", [listing!.id, v?.id ?? null, pv.externalVariationId, pv.sellerSku], c);
        }
      } else if (defaultVariant) {
        await query("insert into listing_variations(listing_id, variant_id, external_variation_id, seller_sku) values ($1,$2,null,$3)", [listing!.id, defaultVariant.id, defaultVariant.sku], c);
      }
      await query("update products set status='active', ml_category_id=$2 where id=$1", [input.productId, input.categoryId], c);
    });
    await audit({ userId, actor: userId ? "user" : "system", action: "listing.publish", entityType: "listing", entityId: listing!.id, details: { externalId: published.externalId, marketplace, priceCents: price } });
    return { listingId: listing!.id, externalId: published.externalId };
  } catch (e) {
    await query("update listings set status='error', sync_error=$2 where id=$1", [listing!.id, (e as Error).message.slice(0, 1000)]);
    throw e;
  }
}

export function normalizeListingStatus(s: string): string {
  return ["active", "paused", "closed", "under_review"].includes(s) ? s : s === "not_yet_active" || s === "payment_required" ? "pending" : "active";
}

/** Envia estoque (e preço recalculado, quando a regra permitir) para o anúncio. */
export async function syncListing(listingId: string) {
  const l = await queryOne<{ id: string; marketplace: MarketplaceId; account_id: string | null; external_id: string; product_id: string | null; price_cents: string; pricing_snapshot: { ruleId?: string | null; manualPrice?: boolean } | null }>(
    "select id, marketplace, account_id, external_id, product_id, price_cents, pricing_snapshot from listings where id = $1",
    [listingId],
  );
  if (!l?.external_id || !l.product_id) return;
  const settings = await getSettings();
  const { adapter, account } = await marketplaceContextFor(l.marketplace, l.account_id);
  const vars = await query<{ external_variation_id: string | null; quantity: number; reserved: number }>(
    `select lv.external_variation_id, coalesce(i.quantity,0) as quantity, coalesce(i.reserved,0) as reserved
     from listing_variations lv left join inventory i on i.variant_id = lv.variant_id where lv.listing_id = $1`,
    [listingId],
  );
  let newPrice: number | undefined;
  if (!l.pricing_snapshot?.manualPrice) {
    const pricing = await priceProduct(l.product_id, l.pricing_snapshot?.ruleId ?? null);
    if (pricing.result.priceCents !== Number(l.price_cents) && pricing.result.netProfitCents > 0) newPrice = pricing.result.priceCents;
  }
  try {
    const withVariation = vars.filter((v) => v.external_variation_id);
    const total = vars.reduce((s, v) => s + sellableStock(v.quantity, v.reserved, settings.stock_safety_margin), 0);
    if (withVariation.length) {
      await adapter.updateItem(account, l.external_id, {
        variations: withVariation.map((v) => ({ externalVariationId: v.external_variation_id!, quantity: sellableStock(v.quantity, v.reserved, settings.stock_safety_margin), priceCents: newPrice })),
      });
    } else {
      await adapter.updateItem(account, l.external_id, { quantity: total, priceCents: newPrice });
    }
    await query(
      "update listings set available_quantity=$2, price_cents=coalesce($3, price_cents), last_synced_at=now(), sync_error=null where id=$1",
      [listingId, total, newPrice ?? null],
    );
    if (total === 0) {
      await raiseAlert({ severity: "warning", type: "listing_out_of_stock", title: "Anúncio sem estoque", entityType: "listing", entityId: listingId, dedupeKey: `listing_oos:${listingId}` });
    }
  } catch (e) {
    await query("update listings set sync_error=$2 where id=$1", [listingId, (e as Error).message.slice(0, 1000)]);
    if (e instanceof MarketplaceError && !e.retryable) return;
    throw e;
  }
}

/** Importa os anúncios existentes da conta e tenta vinculá-los por SELLER_SKU. */
export async function importRemoteListings(userId: string | null, max = 1000) {
  const { adapter, account } = await activeMarketplaceContext();
  let offset = 0, imported = 0, linked = 0;
  while (offset < max) {
    const page = await adapter.listItemIds(account, offset, 50);
    if (!page.ids.length) break;
    for (const id of page.ids) {
      const item = await adapter.getItem(account, id);
      await tx(async (c) => {
        const skuMatch = item.sellerSku
          ? await queryOne<{ product_id: string }>("select product_id from product_variants where sku = $1 union select id from products where sku = $1 limit 1", [item.sellerSku], c)
          : null;
        let productId = skuMatch?.product_id ?? null;
        if (!productId && item.variations.length) {
          for (const v of item.variations) {
            if (!v.sellerSku) continue;
            const m = await queryOne<{ product_id: string }>("select product_id from product_variants where sku = $1", [v.sellerSku], c);
            if (m) { productId = m.product_id; break; }
          }
        }
        const row = await queryOne<{ id: string }>(
          `insert into listings(marketplace, account_id, product_id, external_id, title, status, price_cents, available_quantity, listing_type_id, category_id, permalink, last_synced_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
           on conflict (marketplace, external_id) do update set title=excluded.title, status=excluded.status, price_cents=excluded.price_cents,
             available_quantity=excluded.available_quantity, permalink=excluded.permalink, product_id=coalesce(listings.product_id, excluded.product_id), last_synced_at=now()
           returning id`,
          [adapter.id, account.accountId, productId, item.externalId, item.title, productId ? normalizeListingStatus(item.status) : "unlinked",
           item.priceCents, item.availableQuantity, item.listingTypeId, item.categoryId, item.permalink],
          c,
        );
        for (const v of item.variations.length ? item.variations : [{ externalVariationId: null as string | null, sellerSku: item.sellerSku }]) {
          const variant = v.sellerSku ? await queryOne<{ id: string }>("select id from product_variants where sku = $1", [v.sellerSku], c) : productId ? await queryOne<{ id: string }>("select id from product_variants where product_id=$1 and is_default", [productId], c) : null;
          if (v.externalVariationId) {
            await query(
              `insert into listing_variations(listing_id, variant_id, external_variation_id, seller_sku) values ($1,$2,$3,$4)
               on conflict (listing_id, external_variation_id) do update set variant_id = coalesce(listing_variations.variant_id, excluded.variant_id)`,
              [row!.id, variant?.id ?? null, v.externalVariationId, v.sellerSku], c,
            );
          } else if (variant && !(await queryOne("select 1 from listing_variations where listing_id=$1", [row!.id], c))) {
            await query("insert into listing_variations(listing_id, variant_id, seller_sku) values ($1,$2,$3)", [row!.id, variant.id, v.sellerSku], c);
          }
        }
        if (productId) linked++;
      });
      imported++;
    }
    offset += page.ids.length;
    if (offset >= page.total) break;
  }
  await audit({ userId, action: "listing.import", details: { imported, linked } });
  return { imported, linked };
}

export async function linkListingToProduct(listingId: string, productId: string, userId: string) {
  await tx(async (c) => {
    await query("update listings set product_id=$2, status = case when status='unlinked' then 'active' else status end where id=$1", [listingId, productId], c);
    const lvs = await query<{ id: string; seller_sku: string | null }>("select id, seller_sku from listing_variations where listing_id=$1", [listingId], c);
    if (!lvs.length) {
      const dv = await queryOne<{ id: string; sku: string }>("select id, sku from product_variants where product_id=$1 and is_default", [productId], c);
      if (dv) await query("insert into listing_variations(listing_id, variant_id, seller_sku) values ($1,$2,$3)", [listingId, dv.id, dv.sku], c);
    } else {
      for (const lv of lvs) {
        const v = lv.seller_sku ? await queryOne<{ id: string }>("select id from product_variants where product_id=$1 and sku=$2", [productId, lv.seller_sku], c) : null;
        const fallback = v ?? (lvs.length === 1 ? await queryOne<{ id: string }>("select id from product_variants where product_id=$1 and is_default", [productId], c) : null);
        if (fallback) await query("update listing_variations set variant_id=$2 where id=$1", [lv.id, fallback.id], c);
      }
    }
  });
  await audit({ userId, action: "listing.link", entityType: "listing", entityId: listingId, details: { productId } });
}

export async function setListingStatus(listingId: string, status: "active" | "paused", userId: string) {
  const l = await queryOne<{ marketplace: MarketplaceId; account_id: string | null; external_id: string | null }>("select marketplace, account_id, external_id from listings where id=$1", [listingId]);
  if (!l?.external_id) throw new Error("Anúncio não publicado");
  const { adapter, account } = await marketplaceContextFor(l.marketplace, l.account_id);
  await adapter.updateItem(account, l.external_id, { status });
  await query("update listings set status=$2 where id=$1", [listingId, status]);
  await audit({ userId, action: `listing.${status === "active" ? "activate" : "pause"}`, entityType: "listing", entityId: listingId });
}

/** Atualiza o anúncio local a partir do marketplace (notificação "items"). */
export async function refreshListing(params: { marketplace: MarketplaceId; accountId: string | null; externalId: string }) {
  const l = await queryOne<{ id: string }>("select id from listings where marketplace=$1 and external_id=$2", [params.marketplace, params.externalId]);
  if (!l) return;
  const { adapter, account } = await marketplaceContextFor(params.marketplace, params.accountId);
  const item = await adapter.getItem(account, params.externalId);
  await query("update listings set status=$2, price_cents=$3, available_quantity=$4, title=$5, last_synced_at=now() where id=$1", [l.id, normalizeListingStatus(item.status), item.priceCents, item.availableQuantity, item.title]);
}

/**
 * Publicação automática — executa SOMENTE se o administrador ativou a opção.
 * Publica produtos "ativos" com categoria definida, sem anúncio e com estoque,
 * usando a regra de preço padrão e o tipo de anúncio do perfil de taxas.
 */
export async function autoPublishCandidates(limit = 10) {
  const settings = await getSettings();
  if (!settings.auto_publish_enabled) return { published: 0, skipped: "publicação automática desativada" };
  const rule = await queryOne<{ id: string; listing_type_id: string | null }>(
    "select r.id, f.listing_type_id from pricing_rules r left join fee_profiles f on f.id = r.fee_profile_id where r.is_default",
  );
  if (!rule?.listing_type_id) return { published: 0, skipped: "regra padrão sem perfil de taxas" };
  const marketplace = settings.operation_mode === "production" ? "mercadolivre" : "simulated";
  const candidates = await query<{ id: string; ml_category_id: string; brand: string | null }>(
    `select p.id, p.ml_category_id, p.brand from products p
     where p.status = 'active' and p.ml_category_id is not null
       and not exists (select 1 from listings l where l.product_id = p.id and l.marketplace = $1 and l.status <> 'closed')
     order by p.updated_at limit $2`,
    [marketplace, limit],
  );
  let published = 0;
  for (const c of candidates) {
    try {
      await publishProduct({ productId: c.id, categoryId: c.ml_category_id, listingTypeId: rule.listing_type_id, pricingRuleId: rule.id, attributes: [] }, null);
      published++;
    } catch (e) {
      await raiseAlert({ severity: "warning", type: "auto_publish_failed", title: "Publicação automática não realizada", message: (e as Error).message.slice(0, 400), entityType: "product", entityId: c.id, dedupeKey: `auto_publish:${c.id}` });
    }
  }
  return { published };
}
