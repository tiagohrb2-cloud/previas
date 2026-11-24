import { query, queryOne } from "@/lib/db";
import { getSettings } from "@/lib/settings";

export async function dashboardCounts(marketplace: string) {
  const settings = await getSettings();
  const r = await queryOne<Record<string, string>>(
    `select
       count(*) filter (where true) as total,
       count(*) filter (where status in ('forwarded','supplier_confirmed','preparing','dispatched','in_transit','delivered')) as forwarded,
       count(*) filter (where status in ('awaiting_forward','forwarded','supplier_confirmed','preparing')) as awaiting_dispatch,
       count(*) filter (where status in ('dispatched','in_transit')) as shipped,
       count(*) filter (where status = 'delivered') as delivered,
       count(*) filter (where status = 'problem' or exists (select 1 from claims c where c.order_id = o.id and c.status not in ('resolved','closed'))) as problems,
       count(*) filter (where status = 'returned' or exists (select 1 from returns r where r.order_id = o.id)) as returns,
       count(*) filter (where status = 'received') as received
     from orders o where marketplace = $1`,
    [marketplace],
  );
  const p = await queryOne<Record<string, string>>(
    `with stock as (
       select p.id, p.status, sum(greatest(0, coalesce(i.quantity,0) - coalesce(i.reserved,0) - $1)) as sellable
       from products p join product_variants v on v.product_id = p.id and v.active left join inventory i on i.variant_id = v.id group by p.id)
     select count(*) filter (where status = 'active') as active, count(*) filter (where sellable <= 0) as out_of_stock, count(*) as total from stock`,
    [settings.stock_safety_margin],
  );
  const n = (o: Record<string, string> | null, k: string) => Number(o?.[k] ?? 0);
  return {
    orders: {
      total: n(r, "total"), received: n(r, "received"), forwarded: n(r, "forwarded"), awaitingDispatch: n(r, "awaiting_dispatch"),
      shipped: n(r, "shipped"), delivered: n(r, "delivered"), problems: n(r, "problems"), returns: n(r, "returns"),
    },
    products: { active: n(p, "active"), outOfStock: n(p, "out_of_stock"), total: n(p, "total") },
  };
}

export async function openAlerts(limit = 8) {
  return query<{ id: string; severity: string; title: string; message: string | null; entity_type: string | null; entity_id: string | null; created_at: string }>(
    "select id, severity, title, message, entity_type, entity_id, created_at from alerts where resolved_at is null order by case severity when 'critical' then 0 when 'warning' then 1 else 2 end, created_at desc limit $1",
    [limit],
  );
}

export async function openAlertsCount() {
  const r = await queryOne<{ n: string }>("select count(*) as n from alerts where resolved_at is null");
  return Number(r?.n ?? 0);
}
