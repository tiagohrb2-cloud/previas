import type { PoolClient } from "pg";
import { query, queryOne, tx, type Queryable } from "@/lib/db";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";
import { getSettings } from "@/lib/settings";
import { getAdapter } from "@/modules/suppliers/adapters/registry";
import { getSupplier, supplierContext } from "@/modules/suppliers/service";
import { parseCatalogFile } from "./parsers";
import type { MappingOptions } from "./mapping";
import { normalizedProductSchema, type NormalizedProduct, type RowError } from "./types";

type Source = "api" | "file" | "manual" | "simulated";

/** SKU interno único: prefixo do fornecedor + SKU do fornecedor. */
export function internalSku(supplierId: string, supplierSku: string): string {
  const prefix = supplierId.replace(/-/g, "").slice(0, 4).toUpperCase();
  return `${prefix}-${supplierSku}`.replace(/\s+/g, "-").slice(0, 60);
}

// ---------------------------------------------------------------------------
// Área de preparação (catálogo do fornecedor)
// ---------------------------------------------------------------------------

export async function stageProducts(supplierId: string, products: NormalizedProduct[], source: Source, importJobId: string | null, client?: Queryable) {
  for (const p of products) {
    const stock = p.variants.length ? p.variants.reduce((s, v) => s + (v.stock ?? 0), 0) : p.stock ?? null;
    await query(
      `insert into supplier_catalog_items(supplier_id, supplier_sku, title, cost_cents, stock, data, source, import_job_id, fetched_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8, now())
       on conflict (supplier_id, supplier_sku) do update set
         title=excluded.title, cost_cents=excluded.cost_cents, stock=excluded.stock, data=excluded.data,
         source=excluded.source, import_job_id=excluded.import_job_id, fetched_at=now()`,
      [supplierId, p.supplierSku, p.title, p.costCents, stock, JSON.stringify(p), source, importJobId],
      client,
    );
  }
}

async function createImportJob(supplierId: string, source: Source, fileName: string | null, userId: string | null) {
  const row = await queryOne<{ id: string }>(
    "insert into import_jobs(supplier_id, source, file_name, created_by) values ($1,$2,$3,$4) returning id",
    [supplierId, source, fileName, userId],
  );
  return row!.id;
}

async function finishImportJob(id: string, total: number, ok: number, errors: RowError[], status: "completed" | "failed" = "completed") {
  await query(
    `update import_jobs set status=$2, total_rows=$3, ok_rows=$4, error_rows=$5, errors=$6, finished_at=now() where id=$1`,
    [id, status, total, ok, errors.length, JSON.stringify(errors.slice(0, 500))],
  );
}

/** Lê um arquivo do fornecedor e coloca os produtos válidos no catálogo de preparação. */
export async function importFileToCatalog(supplierId: string, fileName: string, content: ArrayBuffer, opts: MappingOptions, userId: string | null) {
  const supplier = await getSupplier(supplierId);
  if (!supplier) throw new Error("Fornecedor não encontrado");
  const jobId = await createImportJob(supplierId, "file", fileName, userId);
  try {
    const parsed = await parseCatalogFile(fileName, content, opts);
    await tx((c) => stageProducts(supplierId, parsed.products, "file", jobId, c));
    await finishImportJob(jobId, parsed.totalRows, parsed.products.length, parsed.errors);
    await audit({ userId, action: "catalog.file_import", entityType: "supplier", entityId: supplierId, details: { fileName, products: parsed.products.length, errors: parsed.errors.length } });
    return { jobId, staged: parsed.products.length, errors: parsed.errors, headers: parsed.headers };
  } catch (e) {
    await finishImportJob(jobId, 0, 0, [{ row: 0, message: (e as Error).message }], "failed");
    throw e;
  }
}

/** Busca o catálogo pela integração do fornecedor (API real ou simulado no modo teste). */
export async function fetchSupplierCatalog(supplierId: string, userId: string | null, maxPages = 50) {
  const supplier = await getSupplier(supplierId);
  if (!supplier) throw new Error("Fornecedor não encontrado");
  const adapter = getAdapter(supplier.integration_type);
  if (!adapter.fetchCatalog) {
    throw new Error("Este fornecedor não possui integração de catálogo por API. Use a importação por arquivo ou o cadastro manual.");
  }
  const source: Source = supplier.integration_type === "simulated" ? "simulated" : "api";
  const jobId = await createImportJob(supplierId, source, null, userId);
  const ctx = await supplierContext(supplier);
  let cursor: string | null | undefined = null;
  let total = 0;
  const errors: RowError[] = [];
  try {
    for (let page = 0; page < maxPages; page++) {
      const res = await adapter.fetchCatalog(ctx, cursor);
      await stageProducts(supplierId, res.products, source, jobId);
      total += res.products.length;
      (res.errors ?? []).forEach((e) => errors.push({ row: 0, sku: e.sku, message: e.message }));
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    await finishImportJob(jobId, total + errors.length, total, errors);
    await audit({ userId, action: "catalog.api_fetch", entityType: "supplier", entityId: supplierId, details: { products: total } });
    return { jobId, staged: total, errors };
  } catch (e) {
    await finishImportJob(jobId, total, total, [...errors, { row: 0, message: (e as Error).message }], "failed");
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Produtos
// ---------------------------------------------------------------------------

async function setInventory(client: Queryable, variantId: string, quantity: number, reason: string, reference?: string) {
  const prev = await queryOne<{ quantity: number }>("select quantity from inventory where variant_id = $1", [variantId], client);
  await query(
    `insert into inventory(variant_id, quantity, source, updated_at) values ($1,$2,$3, now())
     on conflict (variant_id) do update set quantity = excluded.quantity, source = excluded.source, updated_at = now()`,
    [variantId, quantity, reason],
    client,
  );
  const delta = quantity - (prev?.quantity ?? 0);
  if (delta !== 0 || !prev) {
    await query(
      "insert into inventory_movements(variant_id, delta, reason, reference, quantity_after) values ($1,$2,$3,$4,$5)",
      [variantId, delta, reason, reference ?? null, quantity],
      client,
    );
  }
  return delta !== 0;
}

/**
 * Cria ou atualiza um produto a partir do formato normalizado.
 * Idempotente por (fornecedor, SKU do fornecedor). Mantém o status e os
 * ajustes de preço feitos pelo usuário; atualiza custo, dados e estoque.
 */
export async function upsertProduct(client: PoolClient, supplierId: string, input: NormalizedProduct, source: Source) {
  const p = normalizedProductSchema.parse(input);
  const existing = await queryOne<{ id: string; cost_cents: string }>(
    "select id, cost_cents from products where supplier_id = $1 and supplier_sku = $2",
    [supplierId, p.supplierSku],
    client,
  );
  const row = await queryOne<{ id: string }>(
    `insert into products(supplier_id, supplier_sku, sku, title, description, brand, gtin, cost_cents, weight_g,
        length_cm, width_cm, height_cm, attributes, source, last_synced_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
     on conflict (supplier_id, supplier_sku) do update set
       title=excluded.title, description=excluded.description, brand=excluded.brand, gtin=excluded.gtin,
       cost_cents=excluded.cost_cents, weight_g=excluded.weight_g, length_cm=excluded.length_cm,
       width_cm=excluded.width_cm, height_cm=excluded.height_cm, attributes=excluded.attributes, last_synced_at=now()
     returning id`,
    [supplierId, p.supplierSku, internalSku(supplierId, p.supplierSku), p.title, p.description, p.brand ?? null, p.gtin ?? null,
     p.costCents, p.weightG ?? null, p.lengthCm ?? null, p.widthCm ?? null, p.heightCm ?? null, JSON.stringify(p.attributes), source],
    client,
  );
  const productId = row!.id;

  await query("delete from product_images where product_id = $1", [productId], client);
  for (const [i, url] of p.images.entries()) {
    await query("insert into product_images(product_id, url, position) values ($1,$2,$3) on conflict do nothing", [productId, url, i], client);
  }

  const variants = p.variants.length
    ? p.variants.map((v) => ({ ...v, isDefault: false }))
    : [{ supplierSku: p.supplierSku, gtin: p.gtin, attributes: {}, costCents: undefined, stock: p.stock, isDefault: true }];
  let stockChanged = false;
  const keep: string[] = [];
  for (const v of variants) {
    const vr = await queryOne<{ id: string }>(
      `insert into product_variants(product_id, supplier_sku, sku, gtin, attributes, cost_cents, is_default, active)
       values ($1,$2,$3,$4,$5,$6,$7,true)
       on conflict (product_id, supplier_sku) do update set gtin=excluded.gtin, attributes=excluded.attributes,
         cost_cents=excluded.cost_cents, is_default=excluded.is_default, active=true
       returning id`,
      [productId, v.supplierSku, internalSku(supplierId, v.supplierSku), v.gtin ?? null, JSON.stringify(v.attributes), v.costCents ?? null, v.isDefault],
      client,
    );
    keep.push(vr!.id);
    if (v.stock !== undefined) stockChanged = (await setInventory(client, vr!.id, v.stock, source === "file" ? "import" : "sync")) || stockChanged;
    else await query("insert into inventory(variant_id, quantity, source) values ($1, 0, 'import') on conflict do nothing", [vr!.id], client);
  }
  // variações que deixaram de existir no fornecedor ficam inativas (histórico preservado)
  await query("update product_variants set active = false where product_id = $1 and not (id = any($2::uuid[]))", [productId, keep], client);

  await query("update supplier_catalog_items set imported_product_id = $3 where supplier_id = $1 and supplier_sku = $2", [supplierId, p.supplierSku, productId], client);

  const costChanged = existing ? Number(existing.cost_cents) !== p.costCents : false;
  return { productId, created: !existing, stockChanged, costChanged };
}

/** Importa itens selecionados do catálogo de preparação para "Meus produtos". */
export async function importStagedItems(supplierId: string, supplierSkus: string[] | "all", userId: string | null) {
  const supplier = await getSupplier(supplierId);
  if (!supplier) throw new Error("Fornecedor não encontrado");
  const rows = await query<{ supplier_sku: string; data: NormalizedProduct; source: Source }>(
    supplierSkus === "all"
      ? "select supplier_sku, data, source from supplier_catalog_items where supplier_id = $1"
      : "select supplier_sku, data, source from supplier_catalog_items where supplier_id = $1 and supplier_sku = any($2::text[])",
    supplierSkus === "all" ? [supplierId] : [supplierId, supplierSkus],
  );
  let created = 0, updated = 0;
  const errors: RowError[] = [];
  const changed: string[] = [];
  for (const r of rows) {
    try {
      const res = await tx((c) => upsertProduct(c, supplierId, r.data, r.source));
      if (res.created) created++; else updated++;
      if (res.stockChanged || res.costChanged) changed.push(res.productId);
    } catch (e) {
      errors.push({ row: 0, sku: r.supplier_sku, message: (e as Error).message });
    }
  }
  await onProductsChanged(changed);
  await audit({ userId, action: "catalog.import_products", entityType: "supplier", entityId: supplierId, details: { created, updated, errors: errors.length } });
  return { created, updated, errors };
}

/** Atualiza estoque de todos os produtos do fornecedor pela integração. */
export async function syncSupplierStock(supplierId: string) {
  const supplier = await getSupplier(supplierId);
  if (!supplier) throw new Error("Fornecedor não encontrado");
  const adapter = getAdapter(supplier.integration_type);
  if (!adapter.fetchStock) throw new Error("Fornecedor sem integração de estoque. Atualize por arquivo.");
  const variants = await query<{ id: string; supplier_sku: string; product_id: string }>(
    `select v.id, v.supplier_sku, v.product_id from product_variants v join products p on p.id = v.product_id
     where p.supplier_id = $1 and v.active`,
    [supplierId],
  );
  const ctx = await supplierContext(supplier);
  const changed = new Set<string>();
  for (let i = 0; i < variants.length; i += 100) {
    const chunk = variants.slice(i, i + 100);
    const stock = await adapter.fetchStock(ctx, chunk.map((v) => v.supplier_sku));
    await tx(async (c) => {
      for (const v of chunk) {
        if (stock[v.supplier_sku] === undefined) continue;
        if (await setInventory(c, v.id, stock[v.supplier_sku], "sync")) changed.add(v.product_id);
      }
    });
  }
  await onProductsChanged([...changed]);
  return { variants: variants.length, changedProducts: changed.size };
}

/** Quando custo/estoque mudam, agenda a atualização dos anúncios (se autorizado). */
export async function onProductsChanged(productIds: string[]) {
  if (!productIds.length) return;
  const settings = await getSettings();
  if (!settings.auto_stock_sync_enabled) return;
  const listings = await query<{ id: string }>(
    "select id from listings where product_id = any($1::uuid[]) and status in ('active','paused') and external_id is not null",
    [productIds],
  );
  for (const l of listings) await enqueue("listing.sync", { listingId: l.id }, { dedupeKey: `listing.sync:${l.id}` });
}

export async function setVariantStockManual(variantId: string, quantity: number, userId: string | null) {
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error("Quantidade inválida");
  const v = await queryOne<{ product_id: string }>("select product_id from product_variants where id = $1", [variantId]);
  if (!v) throw new Error("Variação não encontrada");
  const changed = await tx((c) => setInventory(c, variantId, quantity, "manual"));
  if (changed) await onProductsChanged([v.product_id]);
  await audit({ userId, action: "inventory.manual_set", entityType: "variant", entityId: variantId, details: { quantity } });
}

/** Estoque vendável = disponível − reservado − margem de segurança. */
export function sellableStock(quantity: number, reserved: number, safetyMargin: number) {
  return Math.max(0, quantity - reserved - safetyMargin);
}

export async function createManualProduct(supplierId: string, input: NormalizedProduct, userId: string | null) {
  const res = await tx((c) => upsertProduct(c, supplierId, input, "manual"));
  await audit({ userId, action: "product.create_manual", entityType: "product", entityId: res.productId });
  return res.productId;
}
