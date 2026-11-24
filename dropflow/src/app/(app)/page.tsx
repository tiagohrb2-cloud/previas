import Link from "next/link";
import { AlertTriangle, CheckCircle2, PackageCheck, PackageX, RotateCcw, Send, ShoppingBag, Timer, Truck, TrendingUp, Wallet, Boxes } from "lucide-react";
import { Card, PageHeader, StatCard, Table, Td, Th, EmptyState, LinkButton, Notice } from "@/components/ui";
import { RevenueChart, OrdersChart } from "@/components/charts";
import { OrderStatusBadge, SeverityBadge } from "@/components/status";
import { requireUser } from "@/modules/auth/session";
import { activeMarketplace, getSettings } from "@/lib/settings";
import { dashboardCounts, openAlerts } from "@/modules/dashboard/service";
import { dailySeries, financeSummary, periodFromSearch } from "@/modules/finance/service";
import { query, queryOne } from "@/lib/db";
import { formatBRL } from "@/lib/money";
import { formatDateTime, formatNumber } from "@/lib/format";
import { isMercadoLivreConfigured } from "@/lib/env";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  await requireUser("dashboard.view");
  const sp = await searchParams;
  const days = ["7", "30", "90"].includes(sp.dias ?? "") ? sp.dias! : "30";
  const marketplace = await activeMarketplace();
  const period = periodFromSearch({ dias: days });
  const [counts, fin, series, alerts, recent, settings, mlAccount, suppliers] = await Promise.all([
    dashboardCounts(marketplace),
    financeSummary(marketplace, period),
    dailySeries(marketplace, period),
    openAlerts(6),
    query<{ id: string; code: string; status: string; total_cents: string; ordered_at: string; title: string | null }>(
      `select o.id, o.code, o.status, o.total_cents, o.ordered_at, (select title from order_items where order_id=o.id limit 1) as title
       from orders o where marketplace=$1 order by ordered_at desc limit 8`,
      [marketplace],
    ),
    getSettings(),
    queryOne("select 1 from ml_accounts where status='active'"),
    queryOne<{ n: string }>("select count(*) as n from suppliers where active"),
  ]);
  const chart = series.map((s) => ({ day: s.day, revenue: Number(s.revenue), profit: Number(s.profit), orders: Number(s.orders) }));
  const mode = settings.operation_mode;
  const onboarding = [
    { done: Number(suppliers?.n ?? 0) > 0, label: "Cadastrar um fornecedor", href: "/fornecedores/novo" },
    { done: counts.products.total > 0, label: "Importar produtos", href: "/importar" },
    { done: mode === "test" || Boolean(mlAccount), label: "Conectar o Mercado Livre", href: "/configuracoes/mercado-livre" },
    { done: false, label: "Revisar taxas e regra de preço", href: "/configuracoes/precificacao" },
  ];

  return (
    <>
      <PageHeader
        title="Painel"
        description={`Visão geral dos últimos ${days} dias · ${mode === "test" ? "dados simulados (modo teste)" : "Mercado Livre"}`}
        actions={
          <div className="inline-flex rounded-lg bg-white p-0.5 ring-1 ring-slate-200">
            {["7", "30", "90"].map((d) => (
              <Link key={d} href={`/?dias=${d}`} className={`rounded-md px-3 py-1.5 text-xs font-medium ${d === days ? "bg-ink-900 text-white" : "text-slate-600 hover:text-slate-900"}`}>{d} dias</Link>
            ))}
          </div>
        }
      />

      {mode === "production" && !isMercadoLivreConfigured() && (
        <div className="mb-6"><Notice tone="danger" title="Mercado Livre não configurado">Defina ML_CLIENT_ID e ML_CLIENT_SECRET para operar em produção.</Notice></div>
      )}

      {onboarding.some((o) => !o.done) && counts.orders.total === 0 && (
        <Card title="Primeiros passos" className="mb-6">
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {onboarding.map((o, i) => (
              <li key={o.label}>
                <Link href={o.href} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm hover:border-brand-300 hover:bg-brand-50/40">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${o.done ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}>{o.done ? "✓" : i + 1}</span>
                  <span className={o.done ? "text-slate-400 line-through" : "text-slate-800"}>{o.label}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Faturamento" value={formatBRL(fin.revenueCents)} hint={`${fin.ordersCount} vendas no período`} icon={<TrendingUp className="h-4 w-4" />} href="/financeiro" />
        <StatCard label="Lucro estimado" tone={fin.estimatedProfitCents >= 0 ? "brand" : "danger"} value={formatBRL(fin.estimatedProfitCents)} hint={fin.revenueCents ? `${((fin.estimatedProfitCents / fin.revenueCents) * 100).toFixed(1).replace(".", ",")}% do faturamento` : "—"} icon={<Wallet className="h-4 w-4" />} href="/financeiro" />
        <StatCard label="Produtos ativos" value={formatNumber(counts.products.active)} hint={`${counts.products.total} cadastrados`} icon={<Boxes className="h-4 w-4" />} href="/produtos?status=active" />
        <StatCard label="Sem estoque" tone={counts.products.outOfStock ? "warning" : "neutral"} value={formatNumber(counts.products.outOfStock)} icon={<PackageX className="h-4 w-4" />} href="/produtos?estoque=zerado" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Total de vendas" value={counts.orders.total} icon={<ShoppingBag className="h-4 w-4" />} href="/pedidos" />
        <StatCard label="Recebidos" tone="info" value={counts.orders.received} icon={<ShoppingBag className="h-4 w-4" />} href="/pedidos?status=received" />
        <StatCard label="Enviados ao fornecedor" value={counts.orders.forwarded} icon={<Send className="h-4 w-4" />} href="/pedidos?status=forwarded" />
        <StatCard label="Aguardando despacho" tone="warning" value={counts.orders.awaitingDispatch} icon={<Timer className="h-4 w-4" />} href="/pedidos?grupo=aguardando" />
        <StatCard label="Enviados" tone="info" value={counts.orders.shipped} icon={<Truck className="h-4 w-4" />} href="/rastreamento" />
        <StatCard label="Entregues" tone="brand" value={counts.orders.delivered} icon={<PackageCheck className="h-4 w-4" />} href="/pedidos?status=delivered" />
        <StatCard label="Com problemas" tone={counts.orders.problems ? "danger" : "neutral"} value={counts.orders.problems} icon={<AlertTriangle className="h-4 w-4" />} href="/problemas" />
        <StatCard label="Devoluções" value={counts.orders.returns} icon={<RotateCcw className="h-4 w-4" />} href="/problemas?tipo=return" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Faturamento × lucro estimado" description="Lucro = vendas − custo do produto − taxas − frete do vendedor" className="xl:col-span-2">
          {fin.ordersCount ? <RevenueChart data={chart} /> : <EmptyState title="Sem vendas no período" description="O gráfico aparece quando houver vendas." />}
        </Card>
        <Card title="Pedidos por dia">
          {fin.ordersCount ? <OrdersChart data={chart} /> : <p className="py-16 text-center text-sm text-slate-400">Sem pedidos</p>}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Últimos pedidos" padded={false} className="xl:col-span-2" actions={<LinkButton href="/pedidos" variant="ghost" size="sm">Ver todos</LinkButton>}>
          {recent.length ? (
            <Table>
              <thead><tr><Th>Pedido</Th><Th>Produto</Th><Th>Data</Th><Th className="text-right">Valor</Th><Th>Status</Th></tr></thead>
              <tbody>
                {recent.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <Td><Link className="font-medium text-slate-900 hover:text-brand-700" href={`/pedidos/${o.id}`}>{o.code}</Link></Td>
                    <Td className="max-w-[240px] truncate">{o.title}</Td>
                    <Td className="whitespace-nowrap text-slate-500">{formatDateTime(o.ordered_at)}</Td>
                    <Td className="num text-right">{formatBRL(o.total_cents)}</Td>
                    <Td><OrderStatusBadge status={o.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="p-5"><EmptyState title="Nenhum pedido ainda" description={mode === "test" ? "Use o Simulador para criar uma venda de teste." : "As vendas do Mercado Livre aparecem aqui automaticamente."} action={mode === "test" ? <LinkButton href="/simulador" size="sm">Abrir simulador</LinkButton> : undefined} /></div>
          )}
        </Card>
        <Card title="Alertas abertos" padded={false} actions={<LinkButton href="/alertas" variant="ghost" size="sm">Ver todos</LinkButton>}>
          {alerts.length ? (
            <ul className="divide-y divide-slate-100">
              {alerts.map((a) => (
                <li key={a.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900">{a.title}</p>
                    <SeverityBadge severity={a.severity} />
                  </div>
                  {a.message && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{a.message}</p>}
                  <p className="mt-1 text-[11px] text-slate-400">{formatDateTime(a.created_at)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-brand-600" /> Nenhum alerta pendente.</div>
          )}
        </Card>
      </div>
    </>
  );
}
