import { Card, Field, Input, Select, Notice, Table, Td, Th, Badge } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { PriceCalculator } from "@/components/price-calculator";
import { requireUser } from "@/modules/auth/session";
import { can } from "@/modules/auth/permissions";
import { listFeeProfiles, listPricingRules, toTiers } from "@/modules/pricing/service";
import { PRICING_MODE_LABELS } from "@/modules/pricing/calculator";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { feeProfileAction, pricingRuleAction } from "../actions";

const tiersText = (t: { below_cents: number; fee_cents: number }[]) => t.map((x) => `${(x.below_cents / 100).toFixed(2).replace(".", ",")}=${(x.fee_cents / 100).toFixed(2).replace(".", ",")}`).join("; ");

export default async function PricingSettings() {
  const user = await requireUser("settings.view");
  const [fees, rules] = await Promise.all([listFeeProfiles(), listPricingRules()]);
  const canEdit = can(user.role, "settings.edit");
  const ruleValue = (r: (typeof rules)[number]) => (r.mode === "margin_fixed" || r.mode === "fixed_price" ? formatBRL(Number(r.value)) : r.mode === "margin_percent" ? `${Number(r.value)}%` : `${Number(r.value)}×`);
  return (
    <div className="space-y-6">
      <Notice tone="warning" title="Taxas não são universais">
        Comissões e tarifas do Mercado Livre variam por categoria, tipo de anúncio e faixa de preço, e mudam com o tempo. Cadastre os valores conferidos no Mercado Livre (ou consulte a taxa oficial em Configurações › Mercado Livre) e revise periodicamente.
      </Notice>

      <Card title="Perfis de taxas do marketplace" padded={false}>
        {fees.length > 0 && (
          <Table>
            <thead><tr><Th>Nome</Th><Th>Tipo de anúncio</Th><Th>Categoria</Th><Th className="text-right">Comissão</Th><Th>Tarifas fixas</Th><Th>Conferido em</Th></tr></thead>
            <tbody>
              {fees.map((f) => (
                <tr key={f.id}>
                  <Td className="font-medium">{f.name}</Td><Td className="font-mono text-xs">{f.listing_type_id}</Td><Td>{f.category_id ?? "Todas"}</Td>
                  <Td className="num text-right">{String(Number(f.commission_percent)).replace(".", ",")}%</Td>
                  <Td className="text-xs">{f.fixed_fee_tiers.length ? f.fixed_fee_tiers.map((t) => `abaixo de ${formatBRL(t.below_cents)}: ${formatBRL(t.fee_cents)}`).join(" · ") : "—"}</Td>
                  <Td>{formatDate(f.verified_at)} {f.source === "ml_api" && <Badge tone="brand">API</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {canEdit && (
          <div className="border-t border-slate-100 p-5">
            <p className="mb-3 text-sm font-semibold text-slate-800">{fees.length ? "Novo perfil / atualizar" : "Cadastre o primeiro perfil de taxas"}</p>
            <ActionForm action={feeProfileAction} className="grid gap-3 sm:grid-cols-3">
              <Field label="Atualizar perfil existente"><Select name="id" defaultValue=""><option value="">— novo perfil —</option>{fees.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>
              <Field label="Nome"><Input name="name" placeholder="Clássico — Casa e decoração" required /></Field>
              <Field label="Tipo de anúncio (listing_type_id)"><Select name="listing_type_id"><option value="gold_special">Clássico (gold_special)</option><option value="gold_pro">Premium (gold_pro)</option></Select></Field>
              <Field label="Categoria (opcional)"><Input name="category_id" placeholder="MLB…" /></Field>
              <Field label="Comissão (%)"><Input name="commission" inputMode="decimal" required placeholder="conforme o Mercado Livre" /></Field>
              <Field label="Tarifas fixas por faixa" hint='"preço limite=tarifa", separadas por ";" — ex.: 79,00=6,50'><Input name="tiers" /></Field>
              <Field label="Observações" className="sm:col-span-2"><Input name="notes" placeholder="Fonte e data da conferência" /></Field>
              <div className="flex items-end"><SubmitButton>Salvar perfil</SubmitButton></div>
            </ActionForm>
            {fees.length > 0 && <p className="mt-2 text-xs text-slate-400">Faixas atuais: {fees.map((f) => `${f.name}: ${tiersText(f.fixed_fee_tiers) || "nenhuma"}`).join(" | ")}</p>}
          </div>
        )}
      </Card>

      <Card title="Regras de preço" padded={false}>
        {rules.length > 0 && (
          <Table>
            <thead><tr><Th>Regra</Th><Th>Cálculo</Th><Th className="text-right">Valor</Th><Th>Perfil de taxas</Th><Th className="text-right">Custos extras</Th></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium">{r.name} {r.is_default && <Badge tone="brand">padrão</Badge>}</Td>
                  <Td>{PRICING_MODE_LABELS[r.mode]}</Td>
                  <Td className="num text-right">{ruleValue(r)}</Td>
                  <Td>{r.fee_profile_name ?? <Badge tone="warning">sem taxas</Badge>}</Td>
                  <Td className="num text-right">{formatBRL(r.extra_cost_cents)} + {String(Number(r.extra_cost_percent)).replace(".", ",")}%</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {canEdit && (
          <div className="border-t border-slate-100 p-5">
            <ActionForm action={pricingRuleAction} className="grid gap-3 sm:grid-cols-4">
              <Field label="Atualizar regra"><Select name="id" defaultValue=""><option value="">— nova regra —</option>{rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
              <Field label="Nome"><Input name="name" required placeholder="Margem R$ 20" /></Field>
              <Field label="Forma de cálculo"><Select name="mode">{Object.entries(PRICING_MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Valor" hint="R$ (margem/preço), % ou fator"><Input name="value" inputMode="decimal" required /></Field>
              <Field label="Perfil de taxas"><Select name="fee_profile_id" defaultValue=""><option value="">Nenhum</option>{fees.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>
              <Field label="Custo extra por unidade (R$)"><Input name="extra_cost" inputMode="decimal" defaultValue="0" /></Field>
              <Field label="Custo sobre a venda (%)" hint="Ex.: imposto do seu regime"><Input name="extra_percent" inputMode="decimal" defaultValue="0" /></Field>
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="is_default" className="h-4 w-4 accent-emerald-600" /> Regra padrão</label>
              <div className="sm:col-span-4"><SubmitButton>Salvar regra</SubmitButton></div>
            </ActionForm>
          </div>
        )}
      </Card>

      <Card title="Calculadora de preço de venda">
        <PriceCalculator feeProfiles={fees.map((f) => ({ id: f.id, name: f.name, commissionPercent: Number(f.commission_percent), tiers: toTiers(f.fixed_fee_tiers) }))} initial={{ costCents: 3000, extraCents: 1000, mode: "margin_fixed", value: 2000, feeProfileId: "" }} />
      </Card>
    </div>
  );
}
