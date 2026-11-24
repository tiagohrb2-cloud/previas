import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader, DescList, Field, Input, Select, Textarea, Badge, Notice } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { requireUser } from "@/modules/auth/session";
import { can } from "@/modules/auth/permissions";
import { query, queryOne } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { CLAIM_STATUS_LABELS, CLAIM_TYPE_LABELS, RETURN_STATUS_LABELS } from "@/modules/issues/service";
import { claimStatusAction, noteAction, returnAction } from "../actions";

export default async function ClaimDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("issues.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const c = await queryOne<{ id: string; type: string; status: string; external_status: string | null; external_claim_id: string | null; reason: string | null; opened_at: string; due_at: string | null; resolution: string | null; order_id: string | null; code: string | null; supplier_id: string | null; supplier: string | null; product: string | null; marketplace: string }>(
    `select c.*, o.code, s.name as supplier, (select title from order_items where order_id = o.id limit 1) as product
     from claims c left join orders o on o.id = c.order_id left join suppliers s on s.id = c.supplier_id where c.id = $1`, [id]);
  if (!c) notFound();
  const [events, returns] = await Promise.all([
    query<{ id: string; kind: string; message: string; created_at: string; user_name: string | null }>(
      "select e.id, e.kind, e.message, e.created_at, u.name as user_name from claim_events e left join users u on u.id = e.user_id where claim_id = $1 order by e.created_at desc", [id]),
    query<{ id: string; status: string; tracking_reference: string | null; sent_to_supplier_at: string | null; received_by_supplier_at: string | null; notes: string | null }>("select * from returns where claim_id = $1", [id]),
  ]);
  const canOperate = can(user.role, "issues.operate");
  return (
    <>
      <PageHeader back={{ href: "/problemas", label: "Problemas" }} title={`${CLAIM_TYPE_LABELS[c.type]}${c.code ? ` — pedido ${c.code}` : ""}`} description={c.reason ?? undefined} actions={<Badge tone={c.status === "open" ? "danger" : "neutral"}>{CLAIM_STATUS_LABELS[c.status]}</Badge>} />
      <div className="mb-4"><Notice tone="warning">O DropFlow registra e acompanha a ocorrência, mas não realiza reembolsos, cancelamentos nem respostas no Mercado Livre. Faça essas ações no próprio marketplace, dentro do prazo e conforme os procedimentos oficiais.</Notice></div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Detalhes">
            <DescList items={[
              ["Pedido", c.order_id ? <Link className="underline" href={`/pedidos/${c.order_id}`}>{c.code}</Link> : "—"],
              ["Produto", c.product],
              ["Motivo", c.reason],
              ["Aberta em", formatDateTime(c.opened_at)],
              ["Prazo para resolução", formatDateTime(c.due_at)],
              ["Fornecedor responsável", c.supplier_id ? <Link className="underline" href={`/fornecedores/${c.supplier_id}`}>{c.supplier}</Link> : "—"],
              ["Status no marketplace", c.external_status ?? (c.external_claim_id ? "—" : "Registro manual")],
              ["Nº da reclamação", c.external_claim_id],
            ]} />
          </Card>
          {returns.map((r) => (
            <Card key={r.id} title="Devolução do produto" description="Registre o retorno do produto ao fornecedor.">
              <DescList items={[["Situação", RETURN_STATUS_LABELS[r.status]], ["Referência de envio", r.tracking_reference], ["Enviado ao fornecedor", formatDateTime(r.sent_to_supplier_at)], ["Recebido pelo fornecedor", formatDateTime(r.received_by_supplier_at)]]} />
              {canOperate && (
                <ActionForm action={returnAction.bind(null, id)} className="mt-4 grid gap-3 sm:grid-cols-3">
                  <input type="hidden" name="returnId" value={r.id} />
                  <Field label="Nova situação"><Select name="status" defaultValue={r.status}>{Object.entries(RETURN_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                  <Field label="Referência de envio"><Input name="tracking" defaultValue={r.tracking_reference ?? ""} /></Field>
                  <Field label="Observação"><Input name="notes" /></Field>
                  <div className="sm:col-span-3"><SubmitButton variant="secondary">Atualizar devolução</SubmitButton></div>
                </ActionForm>
              )}
            </Card>
          ))}
          <Card title="Histórico de atendimento">
            {canOperate && (
              <ActionForm action={noteAction.bind(null, id)} resetOnSuccess className="mb-5 space-y-2">
                <Textarea name="message" rows={3} placeholder="Registre contato com o comprador, com o fornecedor, decisões…" required />
                <SubmitButton size="sm">Adicionar ao histórico</SubmitButton>
              </ActionForm>
            )}
            <ol className="space-y-3">
              {events.map((e) => (
                <li key={e.id} className="rounded-lg bg-slate-50 px-4 py-3">
                  <p className="whitespace-pre-line text-sm text-slate-800">{e.message}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatDateTime(e.created_at)} · {e.user_name ?? (e.kind === "sync" ? "Mercado Livre" : "Sistema")}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <Card title="Situação interna">
          {canOperate ? (
            <ActionForm action={claimStatusAction.bind(null, id)} className="space-y-3">
              <Field label="Status"><Select name="status" defaultValue={c.status}>{Object.entries(CLAIM_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Resolução"><Textarea name="resolution" rows={3} defaultValue={c.resolution ?? ""} /></Field>
              <SubmitButton>Salvar</SubmitButton>
            </ActionForm>
          ) : <p className="text-sm text-slate-600">{CLAIM_STATUS_LABELS[c.status]}</p>}
        </Card>
      </div>
    </>
  );
}
