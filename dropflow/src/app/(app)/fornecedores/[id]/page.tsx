import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader, Table, Td, Th, Notice, DescList, Badge } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { IntegrationBadge, SupplierOrderBadge } from "@/components/status";
import { requireUser } from "@/modules/auth/session";
import { can } from "@/modules/auth/permissions";
import { canAutoForward, getSupplier } from "@/modules/suppliers/service";
import { getAdapter } from "@/modules/suppliers/adapters/registry";
import { query, queryOne } from "@/lib/db";
import { getMode } from "@/lib/settings";
import { formatBRL } from "@/lib/money";
import { formatDateTime, formatPercent } from "@/lib/format";
import { SupplierFields } from "../supplier-form";
import { IntegrationForm } from "./integration-form";
import { logisticsAction, saveIntegrationAction, testIntegrationAction, updateSupplierAction } from "../actions";

export default async function SupplierDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ novo?: string }> }) {
  const user = await requireUser("suppliers.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await getSupplier(id);
  if (!s) notFound();
  const sp = await searchParams;
  const mode = await getMode();
  const adapter = getAdapter(s.integration_type);
  const [stats, orders, products] = await Promise.all([
    queryOne<Record<string, string>>(
      `select count(*) filter (where status not in ('pending','awaiting_approval','cancelled')) as sent,
         count(*) filter (where status in ('confirmed','preparing','dispatched')) as ok,
         count(*) filter (where status in ('rejected','failed')) as failed,
         avg(extract(epoch from (confirmed_at - submitted_at))/3600) filter (where confirmed_at is not null) as avg_confirm_h,
         coalesce(sum(total_cost_cents) filter (where payment_status='pending' and status in ('submitted','manual_required','confirmed','preparing','dispatched')),0) as pending_pay
       from supplier_orders where supplier_id = $1`, [id]),
    query<{ id: string; order_id: string; code: string; status: string; total_cost_cents: string; created_at: string; payment_status: string }>(
      `select so.id, so.order_id, o.code, so.status, so.total_cost_cents, so.created_at, so.payment_status
       from supplier_orders so join orders o on o.id = so.order_id where so.supplier_id = $1 order by so.created_at desc limit 20`, [id]),
    queryOne<{ total: string; active: string }>("select count(*) as total, count(*) filter (where status='active') as active from products where supplier_id = $1", [id]),
  ]);
  const sent = Number(stats?.sent ?? 0);
  const rate = sent ? (Number(stats?.ok ?? 0) / sent) * 100 : null;
  const gate = canAutoForward(s, mode);
  const canEdit = can(user.role, "suppliers.edit");
  const canIntegrate = can(user.role, "integrations.manage");

  return (
    <>
      <PageHeader back={{ href: "/fornecedores", label: "Fornecedores" }} title={s.name} description={<>{adapter.label} · <IntegrationBadge status={s.integration_status} /></>} />
      {sp.novo && <div className="mb-4"><Notice tone="success">Fornecedor cadastrado. Agora defina o método de integração.</Notice></div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["Produtos vinculados", `${products?.total ?? 0}`, `${products?.active ?? 0} ativos`],
          ["Pedidos encaminhados", String(sent), ""],
          ["Taxa de atendimento", formatPercent(rate), "confirmados ÷ encaminhados"],
          ["Tempo médio p/ confirmar", stats?.avg_confirm_h ? `${Number(stats.avg_confirm_h).toFixed(1).replace(".", ",")} h` : "—", ""],
          ["A pagar ao fornecedor", formatBRL(stats?.pending_pay ?? 0), ""],
        ].map(([l, v, h]) => (
          <div key={l} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{l}</p>
            <p className="num mt-1 text-xl font-semibold text-slate-900">{v}</p>
            {h && <p className="text-xs text-slate-500">{h}</p>}
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Método de integração" description="Como o catálogo, o estoque e os pedidos trafegam entre o DropFlow e este fornecedor.">
            {canIntegrate ? (
              <IntegrationForm action={saveIntegrationAction.bind(null, id)} type={s.integration_type} config={s.integration_config} hasSecret={Boolean(s.integration_secret_enc)} mode={mode} />
            ) : <p className="text-sm text-slate-500">Somente administradores alteram integrações.</p>}
            {s.integration_last_error && <div className="mt-4"><Notice tone="danger" title="Último erro da integração">{s.integration_last_error}</Notice></div>}
          </Card>
          <Card title="Dados cadastrais">
            <ActionForm action={updateSupplierAction.bind(null, id)}><SupplierFields s={s} disabled={!canEdit} /></ActionForm>
          </Card>
          <Card title="Histórico de pedidos" padded={false}>
            {orders.length ? (
              <Table>
                <thead><tr><Th>Pedido</Th><Th>Data</Th><Th className="text-right">Custo</Th><Th>Status</Th><Th>Pagamento</Th></tr></thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <Td><Link href={`/pedidos/${o.order_id}`} className="font-medium hover:text-brand-700">{o.code}</Link></Td>
                      <Td className="text-slate-500">{formatDateTime(o.created_at)}</Td>
                      <Td className="num text-right">{formatBRL(o.total_cost_cents)}</Td>
                      <Td><SupplierOrderBadge status={o.status} /></Td>
                      <Td>{o.payment_status === "paid" ? <Badge tone="brand">Pago</Badge> : <Badge>Pendente</Badge>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : <p className="px-5 py-4 text-sm text-slate-500">Nenhum pedido encaminhado ainda.</p>}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Automação de pedidos">
            {gate.ok ? <Notice tone="success">Este fornecedor pode receber pedidos automaticamente (quando a automação estiver ligada em Configurações).</Notice>
              : <Notice tone="warning" title="Encaminhamento manual">{gate.reason}. Os pedidos ficarão aguardando sua aprovação.</Notice>}
            <ul className="mt-4 space-y-2 text-sm">
              <li className="flex justify-between"><span>Integração verificada</span><span>{s.integration_verified_at ? `✓ ${formatDateTime(s.integration_verified_at)}` : "—"}</span></li>
              <li className="flex justify-between"><span>Logística comprovada</span><span>{s.logistics_verified_at ? `✓ ${formatDateTime(s.logistics_verified_at)}` : "—"}</span></li>
            </ul>
            {canIntegrate && (
              <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                {adapter.testConnection && (
                  <ActionForm action={testIntegrationAction.bind(null, id)}><SubmitButton variant="secondary">Testar conexão</SubmitButton></ActionForm>
                )}
                <ActionForm action={logisticsAction.bind(null, id)} confirm={s.logistics_verified_at ? undefined : "Confirma que já testou com este fornecedor um envio real usando a etiqueta oficial do Mercado Livre, sem troca de etiqueta ou modalidade?"}>
                  <input type="hidden" name="verified" value={s.logistics_verified_at ? "0" : "1"} />
                  <SubmitButton variant={s.logistics_verified_at ? "ghost" : "secondary"}>{s.logistics_verified_at ? "Remover comprovação logística" : "Marcar logística como comprovada"}</SubmitButton>
                </ActionForm>
                <p className="text-xs text-slate-500">Marque somente após um pedido real em que o fornecedor despachou com a etiqueta oficial do Mercado Livre e a modalidade exigida.</p>
              </div>
            )}
          </Card>
          <Card title="Capacidades da integração">
            <DescList items={[
              ["Catálogo automático", adapter.capabilities.catalog ? "Sim" : "Não (arquivo/manual)"],
              ["Estoque automático", adapter.capabilities.stock ? "Sim" : "Não (arquivo/manual)"],
              ["Envio de pedidos", s.integration_type === "rest" || s.integration_type === "simulated" ? "Por API" : "Manual (mensagem gerada)"],
              ["Consulta de status", adapter.capabilities.orderStatus ? "Sim" : "Atualização manual"],
            ]} />
            {s.order_channel_notes && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{s.order_channel_notes}</p>}
          </Card>
          <Card title="Catálogo">
            <div className="flex flex-col gap-2 text-sm">
              <Link className="text-brand-700 underline" href={`/importar?fornecedor=${id}`}>Importar / atualizar catálogo</Link>
              <Link className="text-brand-700 underline" href={`/produtos?fornecedor=${id}`}>Ver produtos deste fornecedor</Link>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
