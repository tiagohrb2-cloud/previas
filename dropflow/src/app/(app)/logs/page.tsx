import type { Metadata } from "next";
import { Card, PageHeader, Table, Td, Th, Badge, Input, Button } from "@/components/ui";
import { requireUser } from "@/modules/auth/session";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Registro de atividades" };

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ q?: string; aba?: string }> }) {
  await requireUser("logs.view");
  const sp = await searchParams;
  const tab = sp.aba ?? "atividades";
  const [logs, notifications, jobs] = await Promise.all([
    tab === "atividades" ? query<{ id: string; actor: string; action: string; entity_type: string | null; entity_id: string | null; details: Record<string, unknown>; ip: string | null; created_at: string; user_name: string | null }>(
      `select a.*, u.name as user_name from audit_logs a left join users u on u.id = a.user_id
       where ($1::text is null or a.action ilike $1 or a.entity_id ilike $1) order by a.created_at desc limit 300`, [sp.q ? `%${sp.q}%` : null]) : Promise.resolve([]),
    tab === "notificacoes" ? query<{ id: string; marketplace: string; topic: string; resource: string; status: string; error: string | null; received_at: string; processed_at: string | null }>(
      "select id, marketplace, topic, resource, status, error, received_at, processed_at from marketplace_notifications order by received_at desc limit 300") : Promise.resolve([]),
    tab === "fila" ? query<{ id: string; type: string; status: string; attempts: number; last_error: string | null; run_at: string; created_at: string }>(
      "select id, type, status, attempts, last_error, run_at, created_at from jobs order by created_at desc limit 300") : Promise.resolve([]),
  ]);
  const tabs: [string, string][] = [["atividades", "Atividades"], ["notificacoes", "Notificações recebidas"], ["fila", "Fila de tarefas"]];
  const tone = (s: string) => (s === "processed" || s === "done" ? "brand" : s === "failed" ? "danger" : s === "ignored" ? "neutral" : "warning");
  return (
    <>
      <PageHeader title="Registro de atividades" description="Auditoria de ações de usuários, notificações do marketplace e tarefas automáticas. Tokens e senhas nunca são registrados." />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {tabs.map(([v, l]) => <a key={v} href={`/logs?aba=${v}`} className={`rounded-full px-3 py-1 ring-1 ring-inset ${tab === v ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-slate-700 ring-slate-300"}`}>{l}</a>)}
      </div>
      <Card padded={false}>
        {tab === "atividades" && (
          <>
            <form className="flex gap-2 border-b border-slate-100 p-4"><input type="hidden" name="aba" value="atividades" /><Input name="q" placeholder="Filtrar por ação ou ID" defaultValue={sp.q} /><Button variant="dark">Filtrar</Button></form>
            <Table>
              <thead><tr><Th>Data</Th><Th>Quem</Th><Th>Ação</Th><Th>Registro</Th><Th>Detalhes</Th><Th>IP</Th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <Td className="whitespace-nowrap text-slate-500">{formatDateTime(l.created_at)}</Td>
                    <Td>{l.user_name ?? <Badge>{l.actor}</Badge>}</Td>
                    <Td className="font-mono text-xs">{l.action}</Td>
                    <Td className="font-mono text-[11px] text-slate-500">{l.entity_type ? `${l.entity_type}:${l.entity_id?.slice(0, 8)}` : "—"}</Td>
                    <Td className="max-w-[320px] truncate font-mono text-[11px] text-slate-500">{Object.keys(l.details).length ? JSON.stringify(l.details) : ""}</Td>
                    <Td className="text-xs text-slate-400">{l.ip ?? ""}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
        {tab === "notificacoes" && (
          <Table>
            <thead><tr><Th>Recebida</Th><Th>Origem</Th><Th>Tópico</Th><Th>Recurso</Th><Th>Status</Th><Th>Erro</Th></tr></thead>
            <tbody>
              {notifications.map((n) => (
                <tr key={n.id}><Td className="whitespace-nowrap text-slate-500">{formatDateTime(n.received_at)}</Td><Td>{n.marketplace === "simulated" ? "Simulador" : "Mercado Livre"}</Td><Td className="font-mono text-xs">{n.topic}</Td><Td className="font-mono text-xs">{n.resource}</Td><Td><Badge tone={tone(n.status)}>{n.status}</Badge></Td><Td className="max-w-[280px] truncate text-xs text-rose-600">{n.error}</Td></tr>
              ))}
            </tbody>
          </Table>
        )}
        {tab === "fila" && (
          <Table>
            <thead><tr><Th>Criada</Th><Th>Tarefa</Th><Th>Status</Th><Th className="text-right">Tentativas</Th><Th>Próxima execução</Th><Th>Erro</Th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}><Td className="whitespace-nowrap text-slate-500">{formatDateTime(j.created_at)}</Td><Td className="font-mono text-xs">{j.type}</Td><Td><Badge tone={tone(j.status)}>{j.status}</Badge></Td><Td className="num text-right">{j.attempts}</Td><Td className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(j.run_at)}</Td><Td className="max-w-[300px] truncate text-xs text-rose-600">{j.last_error}</Td></tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
