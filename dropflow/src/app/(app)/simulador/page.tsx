import Link from "next/link";
import type { Metadata } from "next";
import { Card, PageHeader, Field, Input, Select, Notice, EmptyState, LinkButton } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { OrderStatusBadge } from "@/components/status";
import { requireUser } from "@/modules/auth/session";
import { getMode } from "@/lib/settings";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { cancelAction, claimAction, runQueueAction, saleAction, shipmentAction, stockAction } from "./actions";

export const metadata: Metadata = { title: "Simulador" };

export default async function SimulatorPage() {
  await requireUser("simulator.use");
  if ((await getMode()) !== "test") {
    return (
      <>
        <PageHeader title="Simulador" />
        <Notice tone="warning">O simulador só fica disponível no modo teste. Em produção, todos os eventos vêm do Mercado Livre.</Notice>
      </>
    );
  }
  const [listings, orders, simSkus] = await Promise.all([
    query<{ id: string; title: string; external_id: string; variations: { id: string; sku: string; attrs: Record<string, string> | null }[] | null }>(
      `select l.id, l.title, l.external_id,
         (select json_agg(json_build_object('id', lv.external_variation_id, 'sku', lv.seller_sku, 'attrs', v.attributes)) from listing_variations lv left join product_variants v on v.id = lv.variant_id
          where lv.listing_id = l.id and lv.external_variation_id is not null) as variations
       from listings l where l.marketplace = 'simulated' and l.status = 'active' order by l.title`),
    query<{ id: string; code: string; status: string; external_order_id: string; external_shipment_id: string | null; ordered_at: string; title: string | null }>(
      `select o.id, o.code, o.status, o.external_order_id, o.external_shipment_id, o.ordered_at, (select title from order_items where order_id = o.id limit 1) as title
       from orders o where o.marketplace = 'simulated' order by o.ordered_at desc limit 15`),
    query<{ supplier_sku: string; title: string }>(
      `select v.supplier_sku, p.title from product_variants v join products p on p.id = v.product_id join suppliers s on s.id = p.supplier_id where s.integration_type = 'simulated' order by p.title limit 50`),
  ]);
  return (
    <>
      <PageHeader title="Simulador (modo teste)" description="Gera eventos fictícios que percorrem exatamente o mesmo fluxo da produção: notificação → consulta → estoque → fornecedor → rastreio." actions={<ActionForm action={runQueueAction}><SubmitButton variant="secondary">Processar fila agora</SubmitButton></ActionForm>} />
      <div className="mb-6"><Notice tone="warning">Nada aqui é enviado ao Mercado Livre ou a fornecedores reais. Dados marcados como simulados não aparecem no modo produção.</Notice></div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="1. Simular uma venda">
          {listings.length ? (
            <ActionForm action={saleAction} className="space-y-3">
              <Field label="Anúncio / variação">
                <Select name="listing" required>
                  {listings.flatMap((l) => (l.variations?.length
                    ? l.variations.map((v) => <option key={v.id} value={`${l.id}|${v.id}`}>{l.title} — {Object.values(v.attrs ?? {}).join(" / ") || v.sku}</option>)
                    : [<option key={l.id} value={l.id}>{l.title} ({l.external_id})</option>]))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Quantidade"><Input name="quantity" type="number" min={1} defaultValue={1} /></Field>
                <Field label="Nome do comprador (fictício)"><Input name="buyer" placeholder="Comprador Teste" /></Field>
              </div>
              <SubmitButton>Simular compra paga</SubmitButton>
            </ActionForm>
          ) : <EmptyState title="Nenhum anúncio simulado" description="Importe produtos do fornecedor simulado e publique-os (no modo teste a publicação vai para o marketplace simulado)." action={<LinkButton href="/importar" size="sm">Importar produtos</LinkButton>} />}
        </Card>
        <Card title="Estoque do fornecedor simulado">
          {simSkus.length ? (
            <ActionForm action={stockAction} className="space-y-3">
              <Field label="SKU"><Select name="sku">{simSkus.map((s) => <option key={s.supplier_sku} value={s.supplier_sku}>{s.supplier_sku} — {s.title.slice(0, 40)}</option>)}</Select></Field>
              <Field label="Novo estoque no fornecedor"><Input name="stock" type="number" min={0} defaultValue={0} /></Field>
              <SubmitButton variant="secondary">Alterar estoque</SubmitButton>
            </ActionForm>
          ) : <p className="text-sm text-slate-500">Cadastre um fornecedor com integração “Simulado” e importe o catálogo.</p>}
        </Card>
      </div>
      <Card title="2. Avançar pedidos simulados" className="mt-6" padded={false}>
        {orders.length ? (
          <ul className="divide-y divide-slate-100">
            {orders.map((o) => (
              <li key={o.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_auto]">
                <div>
                  <Link href={`/pedidos/${o.id}`} className="font-medium hover:text-brand-700">{o.code}</Link> <OrderStatusBadge status={o.status} />
                  <p className="text-sm text-slate-600">{o.title}</p>
                  <p className="text-xs text-slate-400">{formatDateTime(o.ordered_at)}</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  {o.external_shipment_id && (
                    <ActionForm action={shipmentAction} className="flex items-end gap-2">
                      <input type="hidden" name="shipmentId" value={o.external_shipment_id} />
                      <Select name="step" className="py-1.5 text-sm">
                        <option value="ready_to_ship">Etiqueta pronta</option>
                        <option value="dropped_off">Postado</option>
                        <option value="shipped">Em trânsito</option>
                        <option value="delivered">Entregue</option>
                        <option value="not_delivered">Falha na entrega</option>
                      </Select>
                      <SubmitButton size="sm" variant="secondary">Envio</SubmitButton>
                    </ActionForm>
                  )}
                  <ActionForm action={claimAction} className="flex items-end gap-2">
                    <input type="hidden" name="orderId" value={o.external_order_id} />
                    <Select name="type" className="py-1.5 text-sm"><option value="claim">Reclamação</option><option value="return">Devolução</option></Select>
                    <SubmitButton size="sm" variant="secondary">Abrir</SubmitButton>
                  </ActionForm>
                  <ActionForm action={cancelAction} confirm="Simular cancelamento desta venda?">
                    <input type="hidden" name="orderId" value={o.external_order_id} />
                    <SubmitButton size="sm" variant="ghost">Cancelar venda</SubmitButton>
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="px-5 py-4 text-sm text-slate-500">Nenhum pedido simulado ainda.</p>}
      </Card>
    </>
  );
}
