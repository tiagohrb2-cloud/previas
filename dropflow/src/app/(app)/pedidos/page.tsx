import Link from "next/link";
import type { Metadata } from "next";
import { Card, PageHeader, Table, Td, Th, EmptyState, Pagination, Input, Select, Button, Badge } from "@/components/ui";
import { OrderStatusBadge } from "@/components/status";
import { requireUser } from "@/modules/auth/session";
import { activeMarketplace } from "@/lib/settings";
import { query, queryOne } from "@/lib/db";
import { formatBRL } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { ORDER_STATUS_LABELS, PROBLEM_LABELS } from "@/modules/orders/status";

export const metadata: Metadata = { title: "Pedidos" };
const PAGE = 30;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser("orders.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.p ?? 1));
  const marketplace = await activeMarketplace();
  const params: unknown[] = [marketplace];
  const where = ["o.marketplace = $1"];
  if (sp.status && sp.status in ORDER_STATUS_LABELS) { params.push(sp.status); where.push(`o.status = $${params.length}`); }
  if (sp.grupo === "aguardando") where.push("o.status in ('awaiting_forward','forwarded','supplier_confirmed','preparing')");
  if (sp.q) { params.push(`%${sp.q}%`); where.push(`(o.code ilike $${params.length} or o.external_order_id ilike $${params.length} or exists (select 1 from order_items oi where oi.order_id = o.id and oi.title ilike $${params.length}))`); }
  const sql = `from orders o where ${where.join(" and ")}`;
  const [rows, total] = await Promise.all([
    query<{ id: string; code: string; external_order_id: string; status: string; problem_reason: string | null; total_cents: string; ordered_at: string; items: string; supplier: string | null; profit: string }>(
      `select o.id, o.code, o.external_order_id, o.status, o.problem_reason, o.total_cents, o.ordered_at,
         (select string_agg(quantity || 'x ' || title, ', ') from order_items where order_id = o.id) as items,
         (select string_agg(distinct s.name, ', ') from order_items oi join suppliers s on s.id = oi.supplier_id where oi.order_id = o.id) as supplier,
         o.total_cents - o.marketplace_fee_cents - o.shipping_cost_cents - (select coalesce(sum(coalesce(unit_cost_cents,0)*quantity),0) from order_items where order_id=o.id) as profit
       ${sql} order by o.ordered_at desc limit ${PAGE} offset ${(page - 1) * PAGE}`, params),
    queryOne<{ n: string }>(`select count(*) as n ${sql}`, params),
  ]);
  const qs = (p: number) => `/pedidos?${new URLSearchParams({ ...(Object.fromEntries(Object.entries(sp).filter(([, v]) => v)) as Record<string, string>), p: String(p) })}`;
  return (
    <>
      <PageHeader title="Pedidos" description="Vendas recebidas do marketplace e seu encaminhamento aos fornecedores." />
      <Card padded={false}>
        <form className="grid gap-2 border-b border-slate-100 p-4 sm:grid-cols-4">
          <Input name="q" placeholder="Nº do pedido, código ou produto" defaultValue={sp.q} className="sm:col-span-2" />
          <Select name="status" defaultValue={sp.status ?? ""}>
            <option value="">Todos os status</option>
            {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Button variant="dark" type="submit">Filtrar</Button>
        </form>
        {rows.length ? (
          <>
            <Table>
              <thead><tr><Th>Pedido</Th><Th>Itens</Th><Th>Fornecedor</Th><Th>Data</Th><Th className="text-right">Valor</Th><Th className="text-right">Lucro est.</Th><Th>Status</Th></tr></thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <Td><Link href={`/pedidos/${o.id}`} className="font-medium text-slate-900 hover:text-brand-700">{o.code}</Link><p className="font-mono text-[11px] text-slate-400">{o.external_order_id}</p></Td>
                    <Td className="max-w-[260px] truncate">{o.items}</Td>
                    <Td className="whitespace-nowrap">{o.supplier ?? <Badge tone="danger">Não vinculado</Badge>}</Td>
                    <Td className="whitespace-nowrap text-slate-500">{formatDateTime(o.ordered_at)}</Td>
                    <Td className="num text-right">{formatBRL(o.total_cents)}</Td>
                    <Td className={`num text-right ${Number(o.profit) < 0 ? "text-rose-600" : "text-brand-700"}`}>{formatBRL(o.profit)}</Td>
                    <Td>
                      <OrderStatusBadge status={o.status} />
                      {o.problem_reason && <p className="mt-1 text-[11px] text-rose-600">{PROBLEM_LABELS[o.problem_reason] ?? o.problem_reason}</p>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} total={Number(total?.n ?? 0)} pageSize={PAGE} baseHref={qs} />
          </>
        ) : <div className="p-5"><EmptyState title="Nenhum pedido encontrado" description="Os pedidos chegam pelas notificações oficiais do Mercado Livre (ou do simulador, no modo teste)." /></div>}
      </Card>
    </>
  );
}
