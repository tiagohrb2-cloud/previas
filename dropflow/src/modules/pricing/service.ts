import { z } from "zod";
import { query, queryOne } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import { calculatePrice, type FixedFeeTier, type PricingMode, type PricingResult } from "./calculator";

export interface FeeProfileRow {
  id: string;
  name: string;
  listing_type_id: string;
  category_id: string | null;
  commission_percent: string;
  fixed_fee_tiers: { below_cents: number; fee_cents: number }[];
  source: "manual" | "ml_api";
  notes: string | null;
  verified_at: string | null;
  updated_at: string;
}

export interface PricingRuleRow {
  id: string;
  name: string;
  mode: PricingMode;
  value: string;
  fee_profile_id: string | null;
  extra_cost_cents: string;
  extra_cost_percent: string;
  supplier_id: string | null;
  is_default: boolean;
}

export const feeProfileSchema = z.object({
  name: z.string().trim().min(2),
  listing_type_id: z.string().trim().min(2),
  category_id: z.string().trim().optional().transform((v) => v || null),
  commission_percent: z.coerce.number().min(0).max(99.99),
  fixed_fee_tiers: z.array(z.object({ below_cents: z.number().int().positive(), fee_cents: z.number().int().nonnegative() })).default([]),
  notes: z.string().optional().transform((v) => v || null),
});

export const pricingRuleSchema = z.object({
  name: z.string().trim().min(2),
  mode: z.enum(["margin_fixed", "margin_percent", "fixed_price", "multiplier"]),
  value: z.coerce.number().nonnegative(),
  fee_profile_id: z.string().uuid().nullable(),
  extra_cost_cents: z.coerce.number().int().nonnegative().default(0),
  extra_cost_percent: z.coerce.number().min(0).max(99).default(0),
  is_default: z.boolean().default(false),
});

export async function listFeeProfiles() {
  return query<FeeProfileRow>("select * from fee_profiles order by name");
}

export async function saveFeeProfile(id: string | null, input: z.input<typeof feeProfileSchema>, userId: string, source: "manual" | "ml_api" = "manual") {
  const d = feeProfileSchema.parse(input);
  const tiers = JSON.stringify(d.fixed_fee_tiers);
  const row = id
    ? await queryOne<{ id: string }>(
        `update fee_profiles set name=$2, listing_type_id=$3, category_id=$4, commission_percent=$5, fixed_fee_tiers=$6, notes=$7, source=$8, verified_at=now() where id=$1 returning id`,
        [id, d.name, d.listing_type_id, d.category_id, d.commission_percent, tiers, d.notes, source],
      )
    : await queryOne<{ id: string }>(
        `insert into fee_profiles(name, listing_type_id, category_id, commission_percent, fixed_fee_tiers, notes, source, verified_at)
         values ($1,$2,$3,$4,$5,$6,$7, now()) returning id`,
        [d.name, d.listing_type_id, d.category_id, d.commission_percent, tiers, d.notes, source],
      );
  await audit({ userId, action: "fee_profile.save", entityType: "fee_profile", entityId: row!.id, details: { commission: d.commission_percent, source } });
  return row!.id;
}

export async function listPricingRules() {
  return query<PricingRuleRow & { fee_profile_name: string | null }>(
    "select r.*, f.name as fee_profile_name from pricing_rules r left join fee_profiles f on f.id = r.fee_profile_id order by r.is_default desc, r.name",
  );
}

export async function savePricingRule(id: string | null, input: z.input<typeof pricingRuleSchema>, userId: string) {
  const d = pricingRuleSchema.parse(input);
  if (d.is_default) await query("update pricing_rules set is_default = false where is_default");
  const params = [d.name, d.mode, d.value, d.fee_profile_id, d.extra_cost_cents, d.extra_cost_percent, d.is_default];
  const row = id
    ? await queryOne<{ id: string }>(
        "update pricing_rules set name=$2, mode=$3, value=$4, fee_profile_id=$5, extra_cost_cents=$6, extra_cost_percent=$7, is_default=$8 where id=$1 returning id",
        [id, ...params],
      )
    : await queryOne<{ id: string }>(
        "insert into pricing_rules(name, mode, value, fee_profile_id, extra_cost_cents, extra_cost_percent, is_default) values ($1,$2,$3,$4,$5,$6,$7) returning id",
        params,
      );
  await audit({ userId, action: "pricing_rule.save", entityType: "pricing_rule", entityId: row!.id });
  return row!.id;
}

export function toTiers(rows: FeeProfileRow["fixed_fee_tiers"]): FixedFeeTier[] {
  return (rows ?? []).map((t) => ({ belowCents: t.below_cents, feeCents: t.fee_cents }));
}

export interface ProductPricing {
  result: PricingResult;
  rule: Pick<PricingRuleRow, "id" | "name" | "mode" | "value"> | null;
  feeProfile: Pick<FeeProfileRow, "id" | "name" | "listing_type_id" | "commission_percent" | "verified_at" | "source"> | null;
  costCents: number;
}

/** Preço de um produto pela regra informada (ou a padrão) — usa o maior custo entre as variações. */
export async function priceProduct(productId: string, ruleId?: string | null, override?: { mode: PricingMode; value: number }): Promise<ProductPricing> {
  const product = await queryOne<{ cost_cents: string; seller_shipping_cost_cents: string; max_variant_cost: string | null }>(
    `select p.cost_cents, p.seller_shipping_cost_cents,
       (select max(coalesce(v.cost_cents, p.cost_cents)) from product_variants v where v.product_id = p.id and v.active) as max_variant_cost
     from products p where p.id = $1`,
    [productId],
  );
  if (!product) throw new Error("Produto não encontrado");
  const rule = ruleId
    ? await queryOne<PricingRuleRow>("select * from pricing_rules where id = $1", [ruleId])
    : await queryOne<PricingRuleRow>("select * from pricing_rules where is_default limit 1");
  const fee = rule?.fee_profile_id ? await queryOne<FeeProfileRow>("select * from fee_profiles where id = $1", [rule.fee_profile_id]) : null;
  const settings = await getSettings();
  const costCents = Number(product.max_variant_cost ?? product.cost_cents);
  const mode = override?.mode ?? rule?.mode ?? "multiplier";
  const value = override?.value ?? (rule ? Number(rule.value) : 2);
  const result = calculatePrice({
    costCents,
    sellerShippingCents: Number(product.seller_shipping_cost_cents),
    extraCostCents: rule ? Number(rule.extra_cost_cents) : 0,
    extraCostPercent: rule ? Number(rule.extra_cost_percent) : 0,
    fee: { commissionPercent: fee ? Number(fee.commission_percent) : 0, fixedFeeTiers: fee ? toTiers(fee.fixed_fee_tiers) : [] },
    mode,
    value,
    rounding: settings.price_rounding,
  });
  if (!rule) result.warnings.push("Nenhuma regra de preço padrão definida: usado multiplicador 2× apenas como referência.");
  return {
    result,
    rule: rule ? { id: rule.id, name: rule.name, mode: rule.mode, value: rule.value } : null,
    feeProfile: fee ? { id: fee.id, name: fee.name, listing_type_id: fee.listing_type_id, commission_percent: fee.commission_percent, verified_at: fee.verified_at, source: fee.source } : null,
    costCents,
  };
}
