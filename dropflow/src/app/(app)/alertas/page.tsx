import Link from "next/link";
import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SeverityBadge } from "@/components/status";
import { requireUser, assertPermission } from "@/modules/auth/session";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { run, str } from "@/lib/actions";
import type { ActionResult } from "@/components/action-form";

export const metadata: Metadata = { title: "Alertas" };

async function resolveAlertAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  "use server";
  return run(async () => {
    await assertPermission("orders.operate");
    await query("update alerts set resolved_at = now() where id = $1", [str(form, "id")]);
    revalidatePath("/alertas");
    return "Alerta marcado como resolvido.";
  });
}

const LINK: Record<string, (id: string) => string> = {
  order: (id) => `/pedidos/${id}`,
  claim: (id) => `/problemas/${id}`,
  listing: () => "/anuncios",
  product: (id) => `/produtos/${id}`,
  job: () => "/logs",
};

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ todos?: string }> }) {
  await requireUser("dashboard.view");
  const sp = await searchParams;
  const alerts = await query<{ id: string; severity: string; type: string; title: string; message: string | null; entity_type: string | null; entity_id: string | null; created_at: string; resolved_at: string | null }>(
    `select * from alerts where ($1 or resolved_at is null) order by resolved_at nulls first, case severity when 'critical' then 0 when 'warning' then 1 else 2 end, created_at desc limit 200`,
    [sp.todos === "1"],
  );
  return (
    <>
      <PageHeader title="Alertas" description="Situações que precisam da sua atenção: falta de estoque, fornecedor sem resposta, reclamações, falhas de integração." actions={<Link className="text-sm text-slate-600 underline" href={sp.todos === "1" ? "/alertas" : "/alertas?todos=1"}>{sp.todos === "1" ? "Somente abertos" : "Ver resolvidos"}</Link>} />
      {alerts.length ? (
        <Card padded={false}>
          <ul className="divide-y divide-slate-100">
            {alerts.map((a) => (
              <li key={a.id} className={`flex flex-wrap items-start justify-between gap-3 px-5 py-4 ${a.resolved_at ? "opacity-50" : ""}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><SeverityBadge severity={a.severity} /><p className="font-medium text-slate-900">{a.title}</p></div>
                  {a.message && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{a.message}</p>}
                  <p className="mt-1 text-xs text-slate-400">{formatDateTime(a.created_at)}{a.entity_type && a.entity_id && LINK[a.entity_type] ? <> · <Link className="underline" href={LINK[a.entity_type](a.entity_id)}>abrir</Link></> : null}</p>
                </div>
                {!a.resolved_at && (
                  <ActionForm action={resolveAlertAction}><input type="hidden" name="id" value={a.id} /><SubmitButton size="sm" variant="secondary">Resolvido</SubmitButton></ActionForm>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : <EmptyState title="Nenhum alerta" description="Tudo em ordem por aqui." />}
    </>
  );
}
