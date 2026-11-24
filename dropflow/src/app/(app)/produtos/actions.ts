"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { query } from "@/lib/db";
import { audit } from "@/lib/audit";
import { parseBRL } from "@/lib/money";
import { run, str } from "@/lib/actions";
import { assertPermission } from "@/modules/auth/session";
import { createManualProduct, setVariantStockManual, onProductsChanged } from "@/modules/catalog/service";
import { publishProduct } from "@/modules/listings/service";
import { activeMarketplaceContext } from "@/modules/marketplace/registry";
import type { ActionResult } from "@/components/action-form";

export async function updateProductAction(id: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("products.edit");
    const data = z.object({
      title: z.string().min(3, "Nome muito curto").max(500),
      description: z.string().max(50000),
      brand: z.string().max(120),
      gtin: z.string().regex(/^(\d{8}|\d{12,14})?$/, "Código de barras deve ter 8, 12, 13 ou 14 dígitos"),
      status: z.enum(["draft", "active", "inactive"]),
      ml_category_id: z.string().max(40),
      condition: z.enum(["new", "used"]),
    }).parse({
      title: str(form, "title"), description: str(form, "description"), brand: str(form, "brand"), gtin: str(form, "gtin").replace(/\D/g, ""),
      status: str(form, "status"), ml_category_id: str(form, "ml_category_id"), condition: str(form, "condition") || "new",
    });
    const shipping = parseBRL(str(form, "seller_shipping") || "0");
    if (shipping === null || shipping < 0) throw new Error("Frete inválido");
    const cost = parseBRL(str(form, "cost"));
    if (cost === null || cost < 0) throw new Error("Custo inválido");
    await query(
      `update products set title=$2, description=$3, brand=nullif($4,''), gtin=nullif($5,''), status=$6, ml_category_id=nullif($7,''),
         condition=$8, seller_shipping_cost_cents=$9, cost_cents=$10 where id=$1`,
      [id, data.title, data.description, data.brand, data.gtin, data.status, data.ml_category_id, data.condition, shipping, cost],
    );
    await audit({ userId: user.id, action: "product.update", entityType: "product", entityId: id });
    await onProductsChanged([id]);
    revalidatePath(`/produtos/${id}`);
    return "Produto atualizado.";
  });
}

export async function setStockAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("products.edit");
    await setVariantStockManual(str(form, "variantId"), Number(str(form, "quantity")), user.id);
    revalidatePath("/produtos");
    return "Estoque atualizado.";
  });
}

export async function createProductAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  let id = "";
  const r = await run(async () => {
    const user = await assertPermission("products.edit");
    const cost = parseBRL(str(form, "cost"));
    if (cost === null) throw new Error("Informe o preço de custo");
    const images = str(form, "images").split(/\s+/).filter((u) => /^https?:\/\//.test(u));
    const num = (k: string) => (str(form, k) ? Number(str(form, k).replace(",", ".")) : undefined);
    const weightKg = num("weight");
    id = await createManualProduct(str(form, "supplierId"), {
      supplierSku: str(form, "sku"),
      title: str(form, "title"),
      description: str(form, "description"),
      brand: str(form, "brand") || undefined,
      gtin: str(form, "gtin").replace(/\D/g, "") || undefined,
      costCents: cost,
      weightG: weightKg !== undefined ? Math.round(weightKg * 1000) : undefined,
      lengthCm: num("length"), widthCm: num("width"), heightCm: num("height"),
      images,
      attributes: {},
      stock: str(form, "stock") ? Math.max(0, Math.floor(Number(str(form, "stock")))) : 0,
      variants: [],
    }, user.id);
  });
  if (!r?.ok) return r;
  redirect(`/produtos/${id}`);
}

export async function predictCategoryAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    await assertPermission("listings.publish");
    const { adapter, account } = await activeMarketplaceContext();
    if (!adapter.predictCategory) throw new Error("Previsão de categoria indisponível");
    const r = await adapter.predictCategory(account, str(form, "title"));
    if (!r.length) throw new Error("Nenhuma categoria sugerida. Informe o código manualmente.");
    return `Sugestões:\n${r.map((c) => `${c.categoryId} — ${c.categoryName} (${c.domainName})`).join("\n")}`;
  });
}

export async function publishAction(productId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  let ok = false;
  const r = await run(async () => {
    const user = await assertPermission("listings.publish");
    const attributes: { id: string; valueName: string }[] = [];
    for (const [k, v] of form.entries()) {
      if (k.startsWith("attr_") && typeof v === "string" && v.trim()) attributes.push({ id: k.slice(5), valueName: v.trim() });
    }
    const manual = str(form, "manualPrice") ? parseBRL(str(form, "manualPrice")) : null;
    const res = await publishProduct({
      productId,
      categoryId: str(form, "categoryId"),
      listingTypeId: str(form, "listingTypeId"),
      pricingRuleId: str(form, "ruleId") || null,
      priceCents: manual,
      title: str(form, "title") || undefined,
      attributes,
    }, user.id);
    ok = true;
    return `Anúncio publicado: ${res.externalId}`;
  });
  if (ok) redirect(`/anuncios?publicado=${productId}`);
  return r;
}
