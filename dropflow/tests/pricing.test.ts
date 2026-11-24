import { describe, expect, it } from "vitest";
import { calculatePrice, breakdown, fixedFeeFor, PricingError } from "@/modules/pricing/calculator";

const noFee = { commissionPercent: 0, fixedFeeTiers: [] };

describe("calculadora de preço", () => {
  it("exemplo do projeto: custo R$30 + margem R$20 + custos R$10 = R$60", () => {
    const r = calculatePrice({ costCents: 3000, extraCostCents: 1000, fee: noFee, mode: "margin_fixed", value: 2000 });
    expect(r.priceCents).toBe(6000);
    expect(r.netProfitCents).toBe(2000);
  });

  it("margem em reais com comissão percentual garante o lucro desejado", () => {
    const fee = { commissionPercent: 12, fixedFeeTiers: [] };
    const r = calculatePrice({ costCents: 3000, extraCostCents: 1000, fee, mode: "margin_fixed", value: 2000 });
    // P = 6000 / 0.88 = 6818.18 -> 6818 (comissão arredondada ao centavo)
    expect(r.priceCents).toBe(6818);
    expect(r.netProfitCents).toBeGreaterThanOrEqual(2000);
    expect(breakdown(r.priceCents - 1, { costCents: 3000, extraCostCents: 1000, fee }).netProfitCents).toBeLessThan(2000);
  });

  it("considera tarifa fixa por faixa e escolhe o menor preço que atinge a meta", () => {
    const fee = { commissionPercent: 10, fixedFeeTiers: [{ belowCents: 7900, feeCents: 600 }] };
    const r = calculatePrice({ costCents: 4000, fee, mode: "margin_fixed", value: 2000 });
    // Com tarifa: (4000+600+2000)/0.9 = 7333.4 -> 7333 com arredondamento da comissão (< 7900, faixa válida)
    expect(r.priceCents).toBe(7333);
    expect(r.fixedFeeCents).toBe(600);
    expect(r.netProfitCents).toBeGreaterThanOrEqual(2000);
  });

  it("quando o preço cai acima da faixa, a tarifa fixa deixa de ser cobrada", () => {
    const fee = { commissionPercent: 10, fixedFeeTiers: [{ belowCents: 7900, feeCents: 600 }] };
    const r = calculatePrice({ costCents: 6000, fee, mode: "margin_fixed", value: 2000 });
    // Sem tarifa: 8000/0.9 = 8888.9 -> 8889 ; com tarifa seria 9556 (fora da faixa)
    expect(r.priceCents).toBe(8889);
    expect(r.fixedFeeCents).toBe(0);
  });

  it("margem percentual sobre o preço de venda", () => {
    const fee = { commissionPercent: 15, fixedFeeTiers: [] };
    const r = calculatePrice({ costCents: 5000, fee, mode: "margin_percent", value: 20 });
    expect(r.marginOnPricePercent).toBeGreaterThanOrEqual(20);
    expect(r.marginOnPricePercent).toBeLessThan(20.1);
  });

  it("multiplicador e preço fixo", () => {
    expect(calculatePrice({ costCents: 3000, fee: noFee, mode: "multiplier", value: 2 }).priceCents).toBe(6000);
    const fixed = calculatePrice({ costCents: 3000, fee: { commissionPercent: 10, fixedFeeTiers: [] }, mode: "fixed_price", value: 3600 });
    expect(fixed.netProfitCents).toBe(3600 - 360 - 3000);
    expect(fixed.warnings.length).toBe(0);
  });

  it("alerta prejuízo e ausência de taxas configuradas", () => {
    const r = calculatePrice({ costCents: 5000, fee: noFee, mode: "fixed_price", value: 4000 });
    expect(r.netProfitCents).toBe(-1000);
    expect(r.warnings.join(" ")).toMatch(/Prejuízo/);
    expect(r.warnings.join(" ")).toMatch(/Nenhuma taxa/);
  });

  it("arredondamento x,90", () => {
    const r = calculatePrice({ costCents: 3000, extraCostCents: 1000, fee: noFee, mode: "margin_fixed", value: 2000, rounding: "ninety" });
    expect(r.priceCents).toBe(6090);
  });

  it("recusa parâmetros impossíveis", () => {
    expect(() => calculatePrice({ costCents: 100, fee: { commissionPercent: 60, fixedFeeTiers: [] }, mode: "margin_percent", value: 40 })).toThrow(PricingError);
    expect(() => calculatePrice({ costCents: -1, fee: noFee, mode: "margin_fixed", value: 1 })).toThrow(PricingError);
  });

  it("tarifa fixa por faixas ordenadas", () => {
    const tiers = [{ belowCents: 7900, feeCents: 650 }, { belowCents: 2900, feeCents: 400 }];
    expect(fixedFeeFor(2000, tiers)).toBe(400);
    expect(fixedFeeFor(5000, tiers)).toBe(650);
    expect(fixedFeeFor(7900, tiers)).toBe(0);
  });
});
