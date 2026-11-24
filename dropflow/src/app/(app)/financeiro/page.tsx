import type { Metadata } from "next";
import { Card, PageHeader, StatCard, Table, Td, Th, Input, Button, Field, Select, Notice } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { RevenueChart } from "@/components/charts";
import { requireUser } from "@/modules/auth/session";
import { can } from "@/modules/auth/permissions";
import { activeMarketplace } from "@/lib/settings";
import { query } from "@/lib/db";
import { formatBRL } from "@/lib/money";
import { formatDate, localDateKey } from "@/lib/format";
import { dailySeries, financeSummary, periodFromSearch, reportByProduct, reportBySupplier } from "@/modules/finance/service";
import { addExpenseAction } from "./actions";

export const metadata: Metadata = { title: "Financeiro" };

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string }> }) {
  const user = await requireUser("finance.view");
  const sp = await searchParams;
  const marketplace = await activeMarketplace();
  const period = periodFromSearch(sp);
  const [s, series, byProduct, bySupplier, expenses] = await Promise.all([
    financeSummary(marketplace, period),
    dailySeries(marketplace, period),
    reportByProduct(marketplace, period),
    reportBySupplier(marketplace, period),
    query<{ id: string; description: string; category: string; amount_cents: string; incurred_on: string }>("select * from costs where incurred_on between $1::date and $2::date order by incurred_on desc", [period.from, period.to]),
  ]);
  const de = sp.de ?? localDateKey(period.from);
  const ate = sp.ate ?? localDateKey(period.to);
  return (
    <>
      <PageHeader
        title="Financeiro"
        description="Faturamento não é lucro: o lucro desconta custo do fornecedor, taxas, frete e despesas."
        actions={
          <form className="flex flex-wrap items-end gap-2">
            <Field label="De"><Input type="date" name="de" defaultValue={de} /></Field>
            <Field label="Até"><Input type="date" name="ate" defaultValue={ate} /></Field>
            <Button variant="dark" type="submit">Aplicar</Button>
          </form>
        }
      />
      {s.unknownCostItems > 0 && <div className="mb-4"><Notice tone="warning">{s.unknownCostItems} item(ns) vendido(s) sem custo conhecido (não vinculados a produto). O lucro está superestimado até o vínculo ser feito.</Notice></div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Faturamento" value={formatBRL(s.revenueCents)} hint={`${s.ordersCount} vendas`} />
        <StatCard label="Custo dos produtos" value={formatBRL(s.productCostCents)} />
        <StatCard label="Taxas do marketplace" value={formatBRL(s.marketplaceFeesCents)} />
        <StatCard label="Custos logísticos" value={formatBRL(s.shippingCostsCents)} />
        <StatCard label="Despesas adicionais" value={formatBRL(s.expensesCents)} />
        <StatCard label="Lucro estimado" tone={s.estimatedProfitCents >= 0 ? "brand" : "danger"} value={formatBRL(s.estimatedProfitCents)} />
        <StatCard label="Lucro realizado" tone="brand" value={formatBRL(s.realizedProfitCents)} hint={`Pedidos entregues sem reclamação (${formatBRL(s.realizedRevenueCents)} vendidos)`} />
        <StatCard label="Fornecedores: pago / pendente" value={formatBRL(s.supplierPaidCents)} hint={`Pendente: ${formatBRL(s.supplierPendingCents)}`} />
      </div>
      <p className="mt-2 text-xs text-slate-500">Lucro realizado considera pedidos entregues sem reclamação aberta; despesas adicionais entram apenas no lucro estimado do período. Confira valores liberados no extrato do Mercado Pago.</p>

      <Card title="Evolução diária" className="mt-6">
        <RevenueChart data={series.map((d) => ({ day: d.day, revenue: Number(d.revenue), profit: Number(d.profit) }))} />
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="Por produto" padded={false}>
          <Table>
            <thead><tr><Th>Produto</Th><Th className="text-right">Un.</Th><Th className="text-right">Faturamento</Th><Th className="text-right">Lucro bruto*</Th></tr></thead>
            <tbody>
              {byProduct.map((r, i) => (
                <tr key={r.product_id ?? i}><Td className="max-w-[240px] truncate">{r.title}</Td><Td className="num text-right">{r.units}</Td><Td className="num text-right">{formatBRL(r.revenue)}</Td><Td className="num text-right">{formatBRL(Number(r.revenue) - Number(r.cost) - Number(r.fees))}</Td></tr>
              ))}
              {!byProduct.length && <tr><Td className="text-slate-400">Sem vendas no período</Td></tr>}
            </tbody>
          </Table>
          <p className="px-4 py-2 text-[11px] text-slate-400">*Antes de frete e despesas.</p>
        </Card>
        <Card title="Por fornecedor" padded={false}>
          <Table>
            <thead><tr><Th>Fornecedor</Th><Th className="text-right">Pedidos</Th><Th className="text-right">Custo</Th><Th className="text-right">Pago</Th><Th className="text-right">Pendente</Th></tr></thead>
            <tbody>
              {bySupplier.map((r, i) => (
                <tr key={r.supplier_id ?? i}><Td>{r.name}</Td><Td className="num text-right">{r.orders}</Td><Td className="num text-right">{formatBRL(r.cost)}</Td><Td className="num text-right">{formatBRL(r.paid)}</Td><Td className="num text-right">{formatBRL(r.pending)}</Td></tr>
              ))}
              {!bySupplier.length && <tr><Td className="text-slate-400">Sem vendas no período</Td></tr>}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card title="Despesas adicionais" className="mt-6">
        {can(user.role, "finance.edit") && (
          <ActionForm action={addExpenseAction} resetOnSuccess className="mb-4 grid gap-3 sm:grid-cols-5">
            <Field label="Descrição" className="sm:col-span-2"><Input name="description" required /></Field>
            <Field label="Categoria"><Select name="category"><option value="operational">Operacional</option><option value="marketing">Marketing / Ads</option><option value="software">Software</option><option value="packaging">Embalagens</option><option value="taxes">Impostos</option><option value="other">Outros</option></Select></Field>
            <Field label="Valor (R$)"><Input name="amount" inputMode="decimal" required /></Field>
            <Field label="Data"><Input name="date" type="date" defaultValue={localDateKey(new Date())} required /></Field>
            <div className="sm:col-span-5"><SubmitButton size="sm">Lançar despesa</SubmitButton></div>
          </ActionForm>
        )}
        {expenses.length ? (
          <ul className="divide-y divide-slate-100 text-sm">
            {expenses.map((e) => <li key={e.id} className="flex justify-between py-2"><span>{formatDate(e.incurred_on)} · {e.description} <span className="text-xs text-slate-400">({e.category})</span></span><span className="num">{formatBRL(e.amount_cents)}</span></li>)}
          </ul>
        ) : <p className="text-sm text-slate-500">Nenhuma despesa no período.</p>}
      </Card>
    </>
  );
}
