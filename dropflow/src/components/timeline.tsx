import { TRACKING_STAGES } from "@/modules/orders/status";
import { formatDateTime } from "@/lib/format";
import { cn } from "./ui";

export interface TimelineEvent {
  stage: string;
  description: string | null;
  source: string;
  occurred_at: string;
}

const SOURCE: Record<string, string> = { marketplace: "Mercado Livre", supplier: "Fornecedor", system: "DropFlow", manual: "Operador" };

/** Etapas do pedido: recebido → encaminhado → confirmado → preparação → despachado → em trânsito → entregue. */
export function StageProgress({ events }: { events: TimelineEvent[] }) {
  const reached = new Set(events.map((e) => e.stage));
  const cancelled = reached.has("cancelled");
  const lastIndex = Math.max(-1, ...TRACKING_STAGES.map((s, i) => (reached.has(s.stage) ? i : -1)));
  const current = lastIndex >= 0 ? TRACKING_STAGES[lastIndex].label : "Aguardando";
  return (
    <>
    <p className="mb-2 text-xs font-medium text-slate-700 sm:hidden">Etapa {Math.max(lastIndex + 1, 0)} de {TRACKING_STAGES.length}: {cancelled ? "Cancelado" : current}</p>
    <ol className="grid grid-cols-7 gap-1">
      {TRACKING_STAGES.map((s, i) => {
        const done = i <= lastIndex;
        return (
          <li key={s.stage} className="min-w-0">
            <div className={cn("h-1.5 rounded-full", done ? (cancelled ? "bg-slate-400" : "bg-brand-500") : "bg-slate-200")} />
            <p className={cn("mt-1.5 hidden truncate text-xs sm:block",done ? "font-medium text-slate-800" : "text-slate-400")} title={s.label}>{s.label}</p>
          </li>
        );
      })}
    </ol>
    </>
  );
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <p className="text-sm text-slate-500">Nenhum evento registrado.</p>;
  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-5">
      {[...events].reverse().map((e, i) => (
        <li key={i} className="relative">
          <span className={cn("absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-white", e.stage === "problem" || e.stage === "cancelled" ? "bg-rose-500" : i === 0 ? "bg-brand-500" : "bg-slate-300")} />
          <p className="text-sm font-medium text-slate-900">{e.description ?? e.stage}</p>
          <p className="text-xs text-slate-500">{formatDateTime(e.occurred_at)} · {SOURCE[e.source] ?? e.source}</p>
        </li>
      ))}
    </ol>
  );
}
