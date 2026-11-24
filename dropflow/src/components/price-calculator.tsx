"use client";

import { useMemo, useState } from "react";
import { calculatePrice, PRICING_MODE_LABELS, PricingError, type PricingMode } from "@/modules/pricing/calculator";
import { Field, Input, Select } from "./ui";

const toCents = (s: string) => {
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Calculadora interativa — usa a MESMA função do servidor (modules/pricing/calculator). */
export function PriceCalculator({
  initial,
  feeProfiles,
}: {
  initial?: { costCents?: number; shippingCents?: number; mode?: PricingMode; value?: number; extraCents?: number; extraPercent?: number; feeProfileId?: string | null };
  feeProfiles: { id: string; name: string; commissionPercent: number; tiers: { belowCents: number; feeCents: number }[] }[];
}) {
  const [cost, setCost] = useState(((initial?.costCents ?? 3000) / 100).toFixed(2).replace(".", ","));
  const [shipping, setShipping] = useState(((initial?.shippingCents ?? 0) / 100).toFixed(2).replace(".", ","));
  const [extra, setExtra] = useState(((initial?.extraCents ?? 0) / 100).toFixed(2).replace(".", ","));
  const [extraPct, setExtraPct] = useState(String(initial?.extraPercent ?? 0).replace(".", ","));
  const [mode, setMode] = useState<PricingMode>(initial?.mode ?? "margin_fixed");
  const [value, setValue] = useState(() => {
    const v = initial?.value ?? 2000;
    return initial?.mode === "margin_percent" || initial?.mode === "multiplier" ? String(v).replace(".", ",") : (v / 100).toFixed(2).replace(".", ",");
  });
  const [feeId, setFeeId] = useState(initial?.feeProfileId ?? feeProfiles[0]?.id ?? "");
  const fee = feeProfiles.find((f) => f.id === feeId);

  const result = useMemo(() => {
    try {
      const numeric = Number(value.replace(",", "."));
      return calculatePrice({
        costCents: toCents(cost),
        sellerShippingCents: toCents(shipping),
        extraCostCents: toCents(extra),
        extraCostPercent: Number(extraPct.replace(",", ".")) || 0,
        fee: { commissionPercent: fee?.commissionPercent ?? 0, fixedFeeTiers: fee?.tiers ?? [] },
        mode,
        value: mode === "margin_fixed" || mode === "fixed_price" ? toCents(value) : numeric,
      });
    } catch (e) {
      return e instanceof PricingError ? e.message : "Valores inválidos";
    }
  }, [cost, shipping, extra, extraPct, mode, value, fee]);

  const valueLabel = { margin_fixed: "Lucro desejado (R$)", margin_percent: "Margem desejada (%)", fixed_price: "Preço de venda (R$)", multiplier: "Multiplicador (×)" }[mode];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Custo do fornecedor (R$)"><Input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        <Field label="Frete pago pelo vendedor (R$)"><Input inputMode="decimal" value={shipping} onChange={(e) => setShipping(e.target.value)} /></Field>
        <Field label="Outros custos por unidade (R$)" hint="Embalagem, operação…"><Input inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} /></Field>
        <Field label="Custos sobre a venda (%)" hint="Ex.: impostos"><Input inputMode="decimal" value={extraPct} onChange={(e) => setExtraPct(e.target.value)} /></Field>
        <Field label="Perfil de taxas do marketplace" className="col-span-2">
          <Select value={feeId} onChange={(e) => setFeeId(e.target.value)}>
            <option value="">Sem taxas (apenas simulação)</option>
            {feeProfiles.map((f) => <option key={f.id} value={f.id}>{f.name} — {f.commissionPercent.toString().replace(".", ",")}%</option>)}
          </Select>
        </Field>
        <Field label="Forma de cálculo"><Select value={mode} onChange={(e) => setMode(e.target.value as PricingMode)}>{Object.entries(PRICING_MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label={valueLabel}><Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
      </div>
      <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
        {typeof result === "string" ? (
          <p className="text-sm text-rose-700">{result}</p>
        ) : (
          <>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Preço de venda</p>
            <p className="num text-3xl font-semibold text-slate-900">{brl(result.priceCents)}</p>
            <dl className="num mt-4 space-y-1.5 text-sm">
              {[
                ["Comissão do marketplace", -result.commissionCents],
                ["Tarifa fixa por unidade", -result.fixedFeeCents],
                ["Frete do vendedor", -result.sellerShippingCents],
                ["Outros custos", -result.extraCostCents],
                ["Custos sobre a venda", -result.extraPercentCostCents],
                ["Custo do produto", -result.productCostCents],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between"><dt className="text-slate-600">{k}</dt><dd className="text-slate-800">{brl(v as number)}</dd></div>
              ))}
              <div className={`flex justify-between border-t border-slate-200 pt-2 font-semibold ${result.netProfitCents > 0 ? "text-brand-700" : "text-rose-700"}`}>
                <dt>Lucro líquido estimado</dt><dd>{brl(result.netProfitCents)}</dd>
              </div>
              <div className="flex justify-between text-xs text-slate-500"><dt>Margem sobre o preço</dt><dd>{result.marginOnPricePercent.toFixed(1).replace(".", ",")}%</dd></div>
            </dl>
            {result.warnings.map((w) => <p key={w} className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">{w}</p>)}
          </>
        )}
      </div>
    </div>
  );
}
