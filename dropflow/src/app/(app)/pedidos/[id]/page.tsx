import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader, Table, Td, Th, Badge, Notice, DescList, Field, Input, Select, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { OrderStatusBadge, SupplierOrderBadge } from "@/components/status";
import { StageProgress, Timeline, type TimelineEvent } from "@/components/timeline";
import { requireUser } from "@/modules/auth/session";
import { can } from "@/modules/auth/permissions";
import { query, queryOne } from "@/lib/db";
import { formatBRL } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { PROBLEM_LABELS, SUPPLIER_TRANSITIONS, SUPPLIER_ORDER_STATUS_LABELS, type SupplierOrderStatus } from "@/modules/orders/status";
import { CLAIM_STATUS_LABELS, CLAIM_TYPE_LABELS } from "@/modules/issues/service";
import { approveAction, manualClaimAction, paymentAction, retryAction, revealBuyerAction, supplierStatusAction } from "../actions";

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("orders.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const o = await queryOne<{
    id: string; code: string; marketplace: string; external_order_id: string; external_pack_id: string | null; external_status: string | null;
    status: string; problem_reason: string | null; total_cents: string; marketplace_fee_cents: string; shipping_cost_cents: string;
    buyer_nickname: string | null; buyer_data_purged_at: string | null; external_shipment_id: string | null; ordered_at: string; paid_at: string | null;
    forwarded_at: string | null; delivered_at: string | null; cancelled_at: string | null;
  }>("select * from orders where id = $1", [id]);
  if (!o) notFound();
  const [items, supplierOrders, shipment, events, claims] = await Promise.all([
    query<{ id: string; title: string; quantity: number; unit_price_cents: string; sale_fee_cents: string; unit_cost_cents: string | null; seller_sku: string | null; external_item_id: string; product_id: string | null; supplier_name: string | null; variant_sku: string | null; variant_attrs: Record<string, string> | null }>(
      `select oi.*, s.name as supplier_name, v.sku as variant_sku, v.attributes as variant_attrs from order_items oi
       left join suppliers s on s.id = oi.supplier_id left join product_variants v on v.id = oi.variant_id where oi.order_id = $1`, [id]),
    query<{ id: string; status: SupplierOrderStatus; supplier_id: string; supplier_name: string; order_channel_notes: string | null; integration_type: string; external_reference: string | null; total_cost_cents: string; message: string | null; last_error: string | null; submitted_at: string | null; confirmation_due_at: string | null; confirmed_at: string | null; payment_status: string; idempotency_key: string }>(
      `select so.*, s.name as supplier_name, s.order_channel_notes, s.integration_type from supplier_orders so join suppliers s on s.id = so.supplier_id where so.order_id = $1 order by so.created_at`, [id]),
    queryOne<{ external_shipment_id: string | null; logistic_type: string | null; mode: string | null; status: string | null; substatus: string | null; tracking_number: string | null; carrier: string | null; last_synced_at: string | null }>(
      "select * from shipments where order_id = $1", [id]),
    query<TimelineEvent>("select stage, description, source, occurred_at from tracking_events where order_id = $1 order by occurred_at, id", [id]),
    query<{ id: string; type: string; status: string; reason: string | null; due_at: string | null }>("select id, type, status, reason, due_at from claims where order_id = $1 order by opened_at desc", [id]),
  ]);
  const cost = items.reduce((s, i) => s + Number(i.unit_cost_cents ?? 0) * i.quantity, 0);
  const profit = Number(o.total_cents) - Number(o.marketplace_fee_cents) - Number(o.shipping_cost_cents) - cost;
  const canOperate = can(user.role, "orders.operate");

  return (
    <>
      <PageHeader
        back={{ href: "/pedidos", label: "Pedidos" }}
        title={`Pedido ${o.code}`}
        description={<>{o.marketplace === "simulated" ? "Marketplace simulado" : "Mercado Livre"} · nº {o.external_order_id}{o.external_pack_id ? ` · pacote ${o.external_pack_id}` : ""} · {formatDateTime(o.ordered_at)}</>}
        actions={<OrderStatusBadge status={o.status} />}
      />
      {o.problem_reason && (
        <div className="mb-4">
          <Notice tone="danger" title={PROBLEM_LABELS[o.problem_reason] ?? o.problem_reason}>
            {o.problem_reason === "out_of_stock" && "O pedido NÃO foi encaminhado ao fornecedor. Verifique o estoque com o fornecedor; após a reposição, clique em Reanalisar."}
            {o.problem_reason === "mapping_missing" && <>Vincule o anúncio a um produto em <Link className="underline" href="/anuncios?status=unlinked">Anúncios</Link> e clique em Reanalisar.</>}
            {o.problem_reason === "supplier_timeout" && "Contate o fornecedor. Quando ele confirmar, registre a confirmação abaixo."}
            {(o.problem_reason === "supplier_rejected" || o.problem_reason === "supplier_failed") && "Resolva com o fornecedor. Cancelamentos e reembolsos devem ser feitos pelo próprio Mercado Livre, seguindo os procedimentos oficiais."}
          </Notice>
        </div>
      )}
      <Card className="mb-6"><StageProgress events={events} /></Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Itens vendidos" padded={false}>
            <Table>
              <thead><tr><Th>Item</Th><Th>Vínculo</Th><Th className="text-right">Qtd.</Th><Th className="text-right">Preço</Th><Th className="text-right">Custo</Th></tr></thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <Td><p className="font-medium text-slate-900">{i.title}</p><p className="font-mono text-[11px] text-slate-400">{i.external_item_id}{i.seller_sku ? ` · ${i.seller_sku}` : ""}</p></Td>
                    <Td>{i.product_id ? <Link href={`/produtos/${i.product_id}`} className="text-sm hover:text-brand-700">{i.supplier_name} · {i.variant_sku}{i.variant_attrs && Object.keys(i.variant_attrs).length ? ` (${Object.values(i.variant_attrs).join("/")})` : ""}</Link> : <Badge tone="danger">Sem vínculo</Badge>}</Td>
                    <Td className="num text-right">{i.quantity}</Td>
                    <Td className="num text-right">{formatBRL(i.unit_price_cents)}</Td>
                    <Td className="num text-right">{formatBRL(i.unit_cost_cents)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card title="Encaminhamento ao fornecedor" description="Um pedido por fornecedor, com chave única que impede duplicidade.">
            {supplierOrders.length ? (
              <div className="space-y-5">
                {supplierOrders.map((so) => {
                  const next = SUPPLIER_TRANSITIONS[so.status].filter((s) => ["confirmed", "preparing", "dispatched", "rejected", "cancelled"].includes(s));
                  return (
                    <div key={so.id} className="rounded-lg border border-slate-200 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <Link href={`/fornecedores/${so.supplier_id}`} className="font-semibold text-slate-900 hover:text-brand-700">{so.supplier_name}</Link>
                          <p className="text-xs text-slate-500">Custo {formatBRL(so.total_cost_cents)} · chave {so.idempotency_key}{so.external_reference ? ` · ref. fornecedor ${so.external_reference}` : ""}</p>
                        </div>
                        <SupplierOrderBadge status={so.status} />
                      </div>
                      <div className="mt-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-3">
                        <span>Enviado: {formatDateTime(so.submitted_at)}</span>
                        <span>Confirmar até: {formatDateTime(so.confirmation_due_at)}</span>
                        <span>Confirmado: {formatDateTime(so.confirmed_at)}</span>
                      </div>
                      {so.last_error && <p className="mt-2 rounded bg-rose-50 px-3 py-2 text-xs text-rose-700">{so.last_error}</p>}
                      {so.status === "manual_required" && so.message && (
                        <div className="mt-3">
                          <p className="mb-1 text-xs font-medium text-slate-700">Envie esta mensagem ao fornecedor{so.order_channel_notes ? ` (${so.order_channel_notes})` : ""}:</p>
                          <Textarea readOnly rows={8} defaultValue={so.message} className="font-mono text-xs" />
                        </div>
                      )}
                      {canOperate && (
                        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
                          {(so.status === "awaiting_approval" || so.status === "failed") && (
                            <ActionForm action={approveAction.bind(null, id)} confirm="Encaminhar este pedido ao fornecedor?">
                              <input type="hidden" name="supplierOrderId" value={so.id} />
                              <SubmitButton>{so.status === "failed" ? "Tentar enviar novamente" : "Aprovar e encaminhar"}</SubmitButton>
                            </ActionForm>
                          )}
                          {next.length > 0 && (
                            <ActionForm action={supplierStatusAction.bind(null, id)} className="flex flex-wrap items-end gap-2">
                              <input type="hidden" name="supplierOrderId" value={so.id} />
                              <Field label="Registrar retorno do fornecedor"><Select name="status">{next.map((s) => <option key={s} value={s}>{SUPPLIER_ORDER_STATUS_LABELS[s]}</option>)}</Select></Field>
                              <Field label="Observação"><Input name="note" placeholder="opcional" /></Field>
                              <SubmitButton variant="secondary">Registrar</SubmitButton>
                            </ActionForm>
                          )}
                          {can(user.role, "finance.edit") && ["submitted", "manual_required", "confirmed", "preparing", "dispatched"].includes(so.status) && (
                            <ActionForm action={paymentAction.bind(null, id)}>
                              <input type="hidden" name="supplierOrderId" value={so.id} />
                              <input type="hidden" name="paid" value={so.payment_status === "paid" ? "0" : "1"} />
                              <SubmitButton variant="ghost" size="sm">{so.payment_status === "paid" ? "Desmarcar pagamento" : "Marcar como pago ao fornecedor"}</SubmitButton>
                            </ActionForm>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-sm text-slate-500">Ainda não encaminhado. {o.problem_reason ? "Resolva a pendência acima." : "O pedido é avaliado quando o pagamento é confirmado."}</p>}
            {canOperate && !o.cancelled_at && (
              <ActionForm action={retryAction.bind(null, id)} className="mt-4">
                <SubmitButton variant="ghost" size="sm">Reanalisar pedido (consultar dados oficiais e estoque)</SubmitButton>
              </ActionForm>
            )}
          </Card>

          <Card title="Rastreamento">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                {shipment ? (
                  <DescList items={[
                    ["Envio", shipment.external_shipment_id],
                    ["Modalidade (definida pelo ML)", [shipment.mode, shipment.logistic_type].filter(Boolean).join(" · ") || "—"],
                    ["Status oficial", [shipment.status, shipment.substatus].filter(Boolean).join(" / ") || "—"],
                    ["Código de rastreio", shipment.tracking_number ?? "Aguardando o marketplace"],
                    ["Transportadora", shipment.carrier],
                    ["Sincronizado em", formatDateTime(shipment.last_synced_at)],
                  ]} />
                ) : <p className="text-sm text-slate-500">Sem dados de envio ainda.</p>}
                {o.marketplace === "mercadolivre" && o.external_shipment_id && (
                  <a className="mt-4 inline-block text-sm text-brand-700 underline" href={`/api/ml/labels/${o.external_shipment_id}`} target="_blank" rel="noreferrer">Baixar etiqueta oficial (PDF) para enviar ao fornecedor</a>
                )}
                <p className="mt-3 text-xs text-slate-500">O código de rastreio e a etiqueta vêm exclusivamente do Mercado Livre. O fornecedor não pode substituí-los.</p>
              </div>
              <Timeline events={events} />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Resultado do pedido">
            <dl className="num space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-slate-600">Venda</dt><dd>{formatBRL(o.total_cents)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Taxas do marketplace</dt><dd>-{formatBRL(o.marketplace_fee_cents)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Frete do vendedor</dt><dd>-{formatBRL(o.shipping_cost_cents)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Custo do fornecedor</dt><dd>-{formatBRL(cost)}</dd></div>
              <div className={`flex justify-between border-t border-slate-200 pt-2 font-semibold ${profit >= 0 ? "text-brand-700" : "text-rose-700"}`}><dt>Lucro {o.status === "delivered" ? "" : "estimado"}</dt><dd>{formatBRL(profit)}</dd></div>
            </dl>
          </Card>
          <Card title="Comprador" description="Dados pessoais usados apenas para processar e entregar o pedido (LGPD).">
            <DescList items={[["Apelido no marketplace", o.buyer_nickname], ["Status no marketplace", o.external_status]]} />
            {o.buyer_data_purged_at ? (
              <p className="mt-3 text-xs text-slate-500">Dados pessoais removidos em {formatDateTime(o.buyer_data_purged_at)} (prazo de retenção).</p>
            ) : can(user.role, "orders.view_buyer_data") && (
              <ActionForm action={revealBuyerAction.bind(null, id)} className="mt-3"><SubmitButton variant="ghost" size="sm">Exibir nome do comprador (acesso registrado)</SubmitButton></ActionForm>
            )}
          </Card>
          <Card title="Reclamações e devoluções" padded={false}>
            {claims.length ? (
              <ul className="divide-y divide-slate-100">
                {claims.map((c) => (
                  <li key={c.id} className="px-5 py-3 text-sm">
                    <Link href={`/problemas/${c.id}`} className="font-medium hover:text-brand-700">{CLAIM_TYPE_LABELS[c.type]}</Link> <Badge tone={c.status === "open" ? "danger" : "neutral"}>{CLAIM_STATUS_LABELS[c.status]}</Badge>
                    {c.reason && <p className="text-xs text-slate-500">{c.reason}</p>}
                  </li>
                ))}
              </ul>
            ) : <p className="px-5 py-4 text-sm text-slate-500">Nenhuma ocorrência.</p>}
            {can(user.role, "issues.operate") && (
              <details className="border-t border-slate-100 px-5 py-3">
                <summary className="cursor-pointer text-sm text-slate-700">Registrar ocorrência manualmente</summary>
                <ActionForm action={manualClaimAction.bind(null, id)} className="mt-3 space-y-3">
                  <Field label="Tipo"><Select name="type">{Object.entries(CLAIM_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                  <Field label="Motivo"><Input name="reason" required /></Field>
                  <Field label="Prazo para resolução"><Input name="dueAt" type="datetime-local" /></Field>
                  <SubmitButton size="sm">Registrar</SubmitButton>
                </ActionForm>
              </details>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
