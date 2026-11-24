import Link from "next/link";
import type { Metadata } from "next";
import { Card, PageHeader, Table, Td, Th, Badge, EmptyState, StatCard } from "@/components/ui";
import { OrderStatusBadge } from "@/components/status";
import { requireUser } from "@/modules/auth/session";
import { activeMarketplace } from "@/lib/settings";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { CLAIM_STATUS_LABELS, CLAIM_TYPE_LABELS } from "@/modules/issues/service";
import { PROBLEM_LABELS } from "@/modules/orders/status";

export const metadata: Metadata = { title: "Problemas" };

export default async function IssuesPage({ searchParams }: { searchParams: Promise<{ tipo?: string; todos?: string }> }) {
  await requireUser("issues.view");
  const sp = await searchParams;
  const marketplace = await activeMarketplace();
  const [claims, problemOrders] = await Promise.all([
    query<{ id: string; type: string; status: string; reason: string | null; opened_at: string; due_at: string | null; order_id: string | null; code: string | null; product: string | null; supplier: string | null }>(
      `select c.id, c.type, c.status, c.reason, c.opened_at, c.due_at, c.order_id, o.code,
         (select title from order_items where order_id = o.id limit 1) as product, s.name as supplier
       from claims c left join orders o on o.id = c.order_id left join suppliers s on s.id = c.supplier_id
       where c.marketplace = $1 and ($2::text is null or c.type = $2) and ($3 or c.status not in ('resolved','closed'))
       order by c.due_at nulls last, c.opened_at desc limit 300`,
      [marketplace, sp.tipo ?? null, sp.todos === "1"],
    ),
    query<{ id: string; code: string; status: string; problem_reason: string; ordered_at: string; product: string | null }>(
      `select o.id, o.code, o.status, o.problem_reason, o.ordered_at, (select title from order_items where order_id = o.id limit 1) as product
       from orders o where o.marketplace = $1 and o.problem_reason is not null order by o.ordered_at desc limit 100`,
      [marketplace],
    ),
  ]);
  const now = Date.now();
  const overdue = claims.filter((c) => c.due_at && new Date(c.due_at).getTime() < now && !["resolved", "closed"].includes(c.status)).length;
  return (
    <>
      <PageHeader title="Central de problemas" description="Reclamações, cancelamentos, devoluções e pedidos travados. Reembolsos e cancelamentos são feitos somente no Mercado Livre, seguindo os procedimentos oficiais." />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Ocorrências abertas" tone={claims.length ? "danger" : "neutral"} value={claims.filter((c) => !["resolved", "closed"].includes(c.status)).length} />
        <StatCard label="Prazo vencido" tone={overdue ? "danger" : "neutral"} value={overdue} />
        <StatCard label="Devoluções" value={claims.filter((c) => c.type === "return").length} />
        <StatCard label="Pedidos travados" tone={problemOrders.length ? "warning" : "neutral"} value={problemOrders.length} />
      </div>

      {problemOrders.length > 0 && (
        <Card title="Pedidos com pendência operacional" padded={false} className="mb-6">
          <Table>
            <thead><tr><Th>Pedido</Th><Th>Produto</Th><Th>Motivo</Th><Th>Data</Th><Th>Status</Th></tr></thead>
            <tbody>
              {problemOrders.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <Td><Link className="font-medium hover:text-brand-700" href={`/pedidos/${o.id}`}>{o.code}</Link></Td>
                  <Td className="max-w-[240px] truncate">{o.product}</Td>
                  <Td className="text-rose-700">{PROBLEM_LABELS[o.problem_reason] ?? o.problem_reason}</Td>
                  <Td className="text-slate-500">{formatDateTime(o.ordered_at)}</Td>
                  <Td><OrderStatusBadge status={o.status} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {[["", "Todas"], ["claim", "Reclamações"], ["cancellation", "Cancelamentos"], ["return", "Devoluções"], ["mediation", "Mediações"]].map(([v, l]) => (
          <Link key={v} href={v ? `/problemas?tipo=${v}` : "/problemas"} className={`rounded-full px-3 py-1 ring-1 ring-inset ${(sp.tipo ?? "") === v ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-slate-700 ring-slate-300"}`}>{l}</Link>
        ))}
        <Link href={`/problemas?${new URLSearchParams({ ...(sp.tipo ? { tipo: sp.tipo } : {}), todos: sp.todos === "1" ? "0" : "1" })}`} className="ml-auto text-slate-600 underline">{sp.todos === "1" ? "Ocultar encerradas" : "Mostrar encerradas"}</Link>
      </div>
      <Card padded={false}>
        {claims.length ? (
          <Table>
            <thead><tr><Th>Pedido</Th><Th>Tipo</Th><Th>Produto</Th><Th>Motivo</Th><Th>Aberta em</Th><Th>Prazo</Th><Th>Fornecedor</Th><Th>Situação</Th></tr></thead>
            <tbody>
              {claims.map((c) => {
                const late = c.due_at && new Date(c.due_at).getTime() < now && !["resolved", "closed"].includes(c.status);
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <Td><Link className="font-medium hover:text-brand-700" href={`/problemas/${c.id}`}>{c.code ?? "—"}</Link></Td>
                    <Td>{CLAIM_TYPE_LABELS[c.type]}</Td>
                    <Td className="max-w-[200px] truncate">{c.product}</Td>
                    <Td className="max-w-[200px] truncate">{c.reason}</Td>
                    <Td className="whitespace-nowrap text-slate-500">{formatDateTime(c.opened_at)}</Td>
                    <Td className={`whitespace-nowrap ${late ? "font-semibold text-rose-600" : ""}`}>{formatDateTime(c.due_at)}</Td>
                    <Td>{c.supplier ?? "—"}</Td>
                    <Td><Badge tone={c.status === "open" ? "danger" : c.status === "resolved" || c.status === "closed" ? "neutral" : "warning"}>{CLAIM_STATUS_LABELS[c.status]}</Badge></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : <div className="p-5"><EmptyState title="Nenhuma ocorrência aberta" description="Reclamações e devoluções do Mercado Livre aparecem aqui assim que notificadas." /></div>}
      </Card>
    </>
  );
}
