/**
 * Calculadora de preço de venda — funções puras (sem banco), em centavos.
 *
 * Lucro líquido = preço − comissão do marketplace − tarifa fixa por unidade
 *                 − frete pago pelo vendedor − custos extras fixos
 *                 − custos extras percentuais (ex.: impostos) − custo do produto
 *
 * As taxas NÃO são fixas no código: vêm de um perfil de taxas configurado pelo
 * administrador ou consultado na API oficial do Mercado Livre.
 */

export type PricingMode = "margin_fixed" | "margin_percent" | "fixed_price" | "multiplier";

export interface FixedFeeTier {
  /** A tarifa se aplica quando o preço é MENOR que este valor (centavos). */
  belowCents: number;
  feeCents: number;
}

export interface FeeProfileInput {
  commissionPercent: number;
  fixedFeeTiers: FixedFeeTier[];
}

export interface PricingInput {
  costCents: number;
  sellerShippingCents?: number;
  extraCostCents?: number;
  extraCostPercent?: number;
  fee: FeeProfileInput;
  mode: PricingMode;
  /**
   * margin_fixed: lucro desejado em centavos
   * margin_percent: lucro desejado em % do preço de venda
   * fixed_price: preço em centavos
   * multiplier: fator sobre o custo (ex.: 2 = dobro do custo)
   */
  value: number;
  rounding?: "none" | "ninety";
}

export interface PricingBreakdown {
  priceCents: number;
  commissionCents: number;
  fixedFeeCents: number;
  marketplaceFeesCents: number;
  sellerShippingCents: number;
  extraCostCents: number;
  extraPercentCostCents: number;
  productCostCents: number;
  totalCostsCents: number;
  netProfitCents: number;
  /** Lucro / preço, em %. */
  marginOnPricePercent: number;
  /** Lucro / custo do produto, em %. */
  returnOnCostPercent: number;
}

export interface PricingResult extends PricingBreakdown {
  mode: PricingMode;
  warnings: string[];
}

export class PricingError extends Error {}

function validateInput(i: PricingInput) {
  const nums: [string, number | undefined][] = [
    ["custo", i.costCents],
    ["frete", i.sellerShippingCents],
    ["custo extra", i.extraCostCents],
    ["custo percentual", i.extraCostPercent],
    ["comissão", i.fee.commissionPercent],
    ["valor da regra", i.value],
  ];
  for (const [name, n] of nums) {
    if (n !== undefined && (!Number.isFinite(n) || n < 0)) throw new PricingError(`Valor inválido para ${name}`);
  }
  if (i.fee.commissionPercent >= 100) throw new PricingError("Comissão deve ser menor que 100%");
}

export function fixedFeeFor(priceCents: number, tiers: FixedFeeTier[]): number {
  const sorted = [...tiers].sort((a, b) => a.belowCents - b.belowCents);
  for (const t of sorted) if (priceCents < t.belowCents) return t.feeCents;
  return 0;
}

export function breakdown(priceCents: number, i: Omit<PricingInput, "mode" | "value">): PricingBreakdown {
  const commissionCents = Math.round((priceCents * i.fee.commissionPercent) / 100);
  const fixedFeeCents = fixedFeeFor(priceCents, i.fee.fixedFeeTiers);
  const sellerShippingCents = i.sellerShippingCents ?? 0;
  const extraCostCents = i.extraCostCents ?? 0;
  const extraPercentCostCents = Math.round((priceCents * (i.extraCostPercent ?? 0)) / 100);
  const productCostCents = i.costCents;
  const marketplaceFeesCents = commissionCents + fixedFeeCents;
  const totalCostsCents = marketplaceFeesCents + sellerShippingCents + extraCostCents + extraPercentCostCents + productCostCents;
  const netProfitCents = priceCents - totalCostsCents;
  return {
    priceCents,
    commissionCents,
    fixedFeeCents,
    marketplaceFeesCents,
    sellerShippingCents,
    extraCostCents,
    extraPercentCostCents,
    productCostCents,
    totalCostsCents,
    netProfitCents,
    marginOnPricePercent: priceCents > 0 ? (netProfitCents / priceCents) * 100 : 0,
    returnOnCostPercent: productCostCents > 0 ? (netProfitCents / productCostCents) * 100 : 0,
  };
}

/** Faixas de preço em que a tarifa fixa é constante: [início, fim) */
function feeRegions(tiers: FixedFeeTier[]): { lo: number; hi: number; fee: number }[] {
  const sorted = [...tiers].sort((a, b) => a.belowCents - b.belowCents);
  const regions: { lo: number; hi: number; fee: number }[] = [];
  let lo = 0;
  for (const t of sorted) {
    if (t.belowCents > lo) regions.push({ lo, hi: t.belowCents, fee: t.feeCents });
    lo = Math.max(lo, t.belowCents);
  }
  regions.push({ lo, hi: Number.POSITIVE_INFINITY, fee: 0 });
  return regions;
}

function applyRounding(priceCents: number, rounding: PricingInput["rounding"]): number {
  if (rounding !== "ninety") return priceCents;
  const reais = Math.floor(priceCents / 100);
  const candidate = reais * 100 + 90;
  return candidate >= priceCents ? candidate : candidate + 100;
}

/** Menor preço cujo lucro atinge a meta (`targetFor(preço)`). */
function solveMinimumPrice(i: PricingInput, targetFor: (price: number) => number, marginPct: number): number {
  const c = i.fee.commissionPercent / 100;
  const p = (i.extraCostPercent ?? 0) / 100;
  const denom = 1 - c - p - marginPct;
  if (denom <= 0) {
    throw new PricingError("A soma de comissão, custos percentuais e margem percentual atinge 100%: não existe preço possível.");
  }
  const base = i.costCents + (i.sellerShippingCents ?? 0) + (i.extraCostCents ?? 0);
  const fixedTarget = marginPct > 0 ? 0 : targetFor(0);
  let best = Number.POSITIVE_INFINITY;
  for (const r of feeRegions(i.fee.fixedFeeTiers)) {
    let price = Math.max(r.lo, Math.ceil((base + r.fee + fixedTarget) / denom));
    // corrige arredondamentos de centavos
    for (let k = 0; k < 10 && breakdown(price, i).netProfitCents < targetFor(price); k++) price++;
    for (let k = 0; k < 10 && price - 1 >= r.lo && breakdown(price - 1, i).netProfitCents >= targetFor(price - 1); k++) price--;
    if (price < r.hi && breakdown(price, i).netProfitCents >= targetFor(price)) best = Math.min(best, price);
  }
  if (!Number.isFinite(best)) throw new PricingError("Não foi possível calcular o preço com os parâmetros informados.");
  return best;
}

export function calculatePrice(i: PricingInput): PricingResult {
  validateInput(i);
  let price: number;
  switch (i.mode) {
    case "fixed_price":
      price = Math.round(i.value);
      break;
    case "multiplier":
      if (i.value <= 0) throw new PricingError("Multiplicador deve ser maior que zero");
      price = Math.ceil(i.costCents * i.value);
      break;
    case "margin_fixed": {
      const target = Math.round(i.value);
      price = solveMinimumPrice(i, () => target, 0);
      break;
    }
    case "margin_percent": {
      if (i.value >= 100) throw new PricingError("Margem percentual deve ser menor que 100%");
      const m = i.value / 100;
      price = solveMinimumPrice(i, (pr) => Math.ceil(pr * m), m);
      break;
    }
    default:
      throw new PricingError("Modo de precificação desconhecido");
  }
  if (i.mode !== "fixed_price") price = applyRounding(price, i.rounding);

  const b = breakdown(price, i);
  const warnings: string[] = [];
  if (b.netProfitCents < 0) warnings.push("Prejuízo: o preço não cobre custos e taxas.");
  else if (b.netProfitCents === 0) warnings.push("Lucro zero neste preço.");
  if (i.fee.commissionPercent === 0 && i.fee.fixedFeeTiers.length === 0) {
    warnings.push("Nenhuma taxa de marketplace configurada: confira o perfil de taxas antes de publicar.");
  }
  return { ...b, mode: i.mode, warnings };
}

export const PRICING_MODE_LABELS: Record<PricingMode, string> = {
  margin_fixed: "Margem em reais",
  margin_percent: "Margem percentual (sobre o preço)",
  fixed_price: "Preço fixo",
  multiplier: "Multiplicador sobre o custo",
};
