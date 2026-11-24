import { query, queryOne } from "@/lib/db";

/**
 * Indicadores financeiros. Faturamento ≠ lucro:
 * - Faturamento: soma das vendas não canceladas.
 * - Lucro estimado: faturamento − custo dos produtos − taxas do marketplace − frete do vendedor − despesas.
 * - Lucro realizado: o mesmo cálculo restrito a pedidos ENTREGUES e sem reclamação aberta.
 *   Não substitui o extrato do Mercado Pago (liberação de dinheiro não é consultada).
 */
export interface FinanceSummary {
  revenueCents: number;
  productCostCents: number;
  marketplaceFeesCents: number;
  shippingCostsCents: number;
  expensesCents: number;
  estimatedProfitCents: number;
  realizedRevenueCents: number;
  realizedProfitCents: number;
  supplierPaidCents: number;
  supplierPendingCents: number;
  ordersCount: number;
  unknownCostItems: number;
}

export interface Period {
  from: Date;
  to: Date;
}

export function periodFromSearch(sp: { de?: string; ate?: string; dias?: string }): Period {
  const to = sp.ate ? new Date(`${sp.ate}T23:59:59-03:00`) : new Date();
  const days = Number(sp.dias ?? 30);
  const from = sp.de ? new Date(`${sp.de}T00:00:00-03:00`) : new Date(to.getTime() - (Number.isFinite(days) ? days : 30) * 86400000);
  return { from, to };
}

const ORDER_BASE = `from orders o where o.marketplace = $1 and o.ordered_at between $2 and $3 and o.status <> 'cancelled'`;

export async function financeSummary(marketplace: string, p: Period): Promise<FinanceSummary> {
  const params = [marketplace, p.from, p.to];
  const r = await queryOne<Record<string, string>>(
    `with o as (select o.* ${ORDER_BASE}),
     items as (select oi.*, o.status as ostatus, o.id as oid from order_items oi join o on o.id = oi.order_id),
     realized as (select o.* from o where o.status = 'delivered'
                    and not exists (select 1 from claims c where c.order_id = o.id and c.status not in ('resolved','closed')))
     select
       (select coalesce(sum(total_cents),0) from o) as revenue,
       (select coalesce(sum(coalesce(unit_cost_cents,0) * quantity),0) from items) as product_cost,
       (select count(*) from items where unit_cost_cents is null) as unknown_cost,
       (select coalesce(sum(marketplace_fee_cents),0) from o) as fees,
       (select coalesce(sum(shipping_cost_cents),0) from o) as shipping,
       (select count(*) from o) as orders,
       (select coalesce(sum(total_cents),0) from realized) as r_revenue,
       (select coalesce(sum(total_cents - marketplace_fee_cents - shipping_cost_cents),0) from realized) as r_net,
       (select coalesce(sum(coalesce(oi.unit_cost_cents,0) * oi.quantity),0) from order_items oi join realized r on r.id = oi.order_id) as r_cost,
       (select coalesce(sum(so.total_cost_cents),0) from supplier_orders so join o on o.id = so.order_id where so.payment_status = 'paid') as sup_paid,
       (select coalesce(sum(so.total_cost_cents),0) from supplier_orders so join o on o.id = so.order_id
          where so.payment_status = 'pending' and so.status in ('submitted','manual_required','confirmed','preparing','dispatched')) as sup_pending`,
    params,
  );
  const exp = await queryOne<{ total: string }>("select coalesce(sum(amount_cents),0) as total from costs where incurred_on between $1::date and $2::date", [p.from, p.to]);
  const n = (k: string) => Number(r?.[k] ?? 0);
  const expenses = Number(exp?.total ?? 0);
  return {
    revenueCents: n("revenue"),
    productCostCents: n("product_cost"),
    marketplaceFeesCents: n("fees"),
    shippingCostsCents: n("shipping"),
    expensesCents: expenses,
    estimatedProfitCents: n("revenue") - n("product_cost") - n("fees") - n("shipping") - expenses,
    realizedRevenueCents: n("r_revenue"),
    realizedProfitCents: n("r_net") - n("r_cost"),
    supplierPaidCents: n("sup_paid"),
    supplierPendingCents: n("sup_pending"),
    ordersCount: n("orders"),
    unknownCostItems: n("unknown_cost"),
  };
}

export async function dailySeries(marketplace: string, p: Period) {
  return query<{ day: string; revenue: string; profit: string; orders: string }>(
    `with days as (select generate_series(date_trunc('day', $2::timestamptz at time zone 'America/Sao_Paulo'),
                                         date_trunc('day', $3::timestamptz at time zone 'America/Sao_Paulo'), interval '1 day')::date as day),
     o as (select (o.ordered_at at time zone 'America/Sao_Paulo')::date as day, o.total_cents, o.marketplace_fee_cents, o.shipping_cost_cents,
             (select coalesce(sum(coalesce(unit_cost_cents,0)*quantity),0) from order_items oi where oi.order_id = o.id) as cost
           ${ORDER_BASE})
     select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(sum(o.total_cents),0) as revenue,
       coalesce(sum(o.total_cents - o.marketplace_fee_cents - o.shipping_cost_cents - o.cost),0) as profit, count(o.day) as orders
     from days d left join o on o.day = d.day group by d.day order by d.day`,
    [marketplace, p.from, p.to],
  );
}

export async function reportByProduct(marketplace: string, p: Period) {
  return query<{ product_id: string | null; title: string; units: string; revenue: string; cost: string; fees: string }>(
    `select oi.product_id, coalesce(pr.title, max(oi.title)) as title, sum(oi.quantity) as units,
       sum(oi.unit_price_cents * oi.quantity) as revenue, sum(coalesce(oi.unit_cost_cents,0) * oi.quantity) as cost,
       sum(oi.sale_fee_cents * oi.quantity) as fees
     from order_items oi join orders o on o.id = oi.order_id left join products pr on pr.id = oi.product_id
     where o.marketplace = $1 and o.ordered_at between $2 and $3 and o.status <> 'cancelled'
     group by oi.product_id, pr.title order by revenue desc limit 200`,
    [marketplace, p.from, p.to],
  );
}

export async function reportBySupplier(marketplace: string, p: Period) {
  return query<{ supplier_id: string | null; name: string; orders: string; revenue: string; cost: string; paid: string; pending: string }>(
    `select s.id as supplier_id, coalesce(s.name, 'Sem fornecedor') as name, count(distinct o.id) as orders,
       sum(oi.unit_price_cents * oi.quantity) as revenue, sum(coalesce(oi.unit_cost_cents,0) * oi.quantity) as cost,
       coalesce((select sum(so.total_cost_cents) from supplier_orders so join orders o2 on o2.id = so.order_id
                 where so.supplier_id = s.id and so.payment_status='paid' and o2.marketplace=$1 and o2.ordered_at between $2 and $3),0) as paid,
       coalesce((select sum(so.total_cost_cents) from supplier_orders so join orders o2 on o2.id = so.order_id
                 where so.supplier_id = s.id and so.payment_status='pending' and so.status in ('submitted','manual_required','confirmed','preparing','dispatched')
                   and o2.marketplace=$1 and o2.ordered_at between $2 and $3),0) as pending
     from order_items oi join orders o on o.id = oi.order_id left join suppliers s on s.id = oi.supplier_id
     where o.marketplace = $1 and o.ordered_at between $2 and $3 and o.status <> 'cancelled'
     group by s.id, s.name order by revenue desc`,
    [marketplace, p.from, p.to],
  );
}

export async function addExpense(input: { description: string; category: string; amountCents: number; incurredOn: string }, userId: string) {
  if (!input.description.trim()) throw new Error("Descreva a despesa");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error("Valor inválido");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.incurredOn)) throw new Error("Data inválida");
  await query("insert into costs(description, category, amount_cents, incurred_on, created_by) values ($1,$2,$3,$4,$5)", [input.description.trim(), input.category, input.amountCents, input.incurredOn, userId]);
}
