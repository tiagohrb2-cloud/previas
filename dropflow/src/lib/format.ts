import { env } from "./env";

function tz() {
  try {
    return env().APP_TIMEZONE;
  } catch {
    return "America/Sao_Paulo";
  }
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: tz() }).format(new Date(d));
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: tz() }).format(new Date(d));
}

export function formatNumber(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("pt-BR").format(Number(n));
}

export function formatPercent(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

/** Mascara dados pessoais para exibição (LGPD: mínimo necessário). */
export function maskName(name: string | null | undefined): string {
  if (!name) return "—";
  return name
    .split(/\s+/)
    .map((p, i) => (i === 0 ? p : `${p[0] ?? ""}.`))
    .join(" ");
}

/** Data (YYYY-MM-DD) no fuso da aplicação. */
export function localDateKey(d: Date | string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
  return parts;
}
