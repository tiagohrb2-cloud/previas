import Link from "next/link";
import type { Metadata } from "next";
import { Card, PageHeader, EmptyState, Badge } from "@/components/ui";
import { OrderStatusBadge } from "@/components/status";
import { StageProgress, type TimelineEvent } from "@/components/timeline";
import { requireUser } from "@/modules/auth/session";
import { activeMarketplace } from "@/lib/settings";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { TRACKING_STAGES } from "@/modules/orders/status";

export const metadata: Metadata = { title: "Rastreamento" };

export default async function TrackingPage({ searchParams }: { searchParams: Promise<{ etapa?: string }> }) {
  await requireUser("orders.view");
  const sp = await searchParams;
  const marketplace = await activeMarketplace();
  const rows = await query<{ id: string; code: string; status: string; ordered_at: string; title: string | null; supplier: string | null; tracking_number: string | null; carrier: string | null; ship_status: string | null; logistic_type: string | null; last_synced_at: string | null; events: TimelineEvent[] }>(
    `select o.id, o.code, o.status, o.ordered_at,
       (select title from order_items where order_id = o.id limit 1) as title,
       (select string_agg(distinct s.name, ', ') from order_items oi join suppliers s on s.id = oi.supplier_id where oi.order_id = o.id) as supplier,
       sh.tracking_number, sh.carrier, sh.status as ship_status, sh.logistic_type, sh.last_synced_at,
       coalesce((select json_agg(json_build_object('stage', stage, 'description', description, 'source', source, 'occurred_at', occurred_at) order by occurred_at)
                 from tracking_events te where te.order_id = o.id), '[]') as events
     from orders o left join shipments sh on sh.order_id = o.id
     where o.marketplace = $1 and o.status not in ('cancelled') and ($2::text is null or o.status = $2)
     order by case when o.status = 'delivered' then 1 else 0 end, o.ordered_at desc limit 200`,
    [marketplace, sp.etapa ?? null],
  );
  const filters: [string, string][] = [["", "Todos"], ["awaiting_forward", "Aguardando encaminhamento"], ["forwarded", "Encaminhados"], ["supplier_confirmed", "Confirmados"], ["preparing", "Em preparação"], ["dispatched", "Despachados"], ["in_transit", "Em trânsito"], ["delivered", "Entregues"], ["problem", "Com problema"]];
  return (
    <>
      <PageHeader title="Central de rastreamento" description={`Etapas: ${TRACKING_STAGES.map((s) => s.label).join(" → ")}. Dados de envio sincronizados pela integração oficial.`} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {filters.map(([v, l]) => (
          <Link key={v} href={v ? `/rastreamento?etapa=${v}` : "/rastreamento"} className={`rounded-full px-3 py-1 ring-1 ring-inset ${(sp.etapa ?? "") === v ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-slate-700 ring-slate-300"}`}>{l}</Link>
        ))}
      </div>
      {rows.length ? (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/pedidos/${r.id}`} className="font-semibold text-slate-900 hover:text-brand-700">{r.code}</Link>
                  <p className="max-w-xl truncate text-sm text-slate-600">{r.title}</p>
                  <p className="text-xs text-slate-500">{r.supplier ?? "Sem fornecedor"} · {formatDateTime(r.ordered_at)}</p>
                </div>
                <div className="text-right">
                  <OrderStatusBadge status={r.status} />
                  <p className="mt-1 text-xs text-slate-500">{r.tracking_number ? <>Rastreio: <span className="font-mono">{r.tracking_number}</span></> : "Rastreio: aguardando o marketplace"}</p>
                  {r.logistic_type && <Badge>{r.logistic_type}</Badge>}
                </div>
              </div>
              <div className="mt-4"><StageProgress events={r.events} /></div>
            </Card>
          ))}
        </div>
      ) : <EmptyState title="Nenhum pedido para rastrear" />}
    </>
  );
}
