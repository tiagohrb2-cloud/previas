/** Todos os valores monetários são inteiros em centavos (BRL). */

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(cents: number | bigint | string | null | undefined): string {
  if (cents === null || cents === undefined || cents === "") return "—";
  return brl.format(Number(cents) / 100);
}

/** Converte "R$ 1.234,56", "1234,56", "1234.56", 1234.56 em centavos. Retorna null se inválido. */
export function parseBRL(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input * 100) : null;
  let s = String(input).trim().replace(/R\$\s?/i, "").replace(/\s/g, "");
  if (!s) return null;
  const negative = s.startsWith("-");
  s = s.replace(/^-/, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // o último separador é o decimal
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma > -1) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > -1) {
    // "1.234" (milhar) vs "12.5" (decimal): 3 dígitos após o único ponto e mais de um ponto => milhar
    const dots = s.split(".").length - 1;
    const decimals = s.length - lastDot - 1;
    if (dots > 1 || (decimals === 3 && s.length > 4 && /^\d{1,3}(\.\d{3})+$/.test(s))) s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  return negative ? -cents : cents;
}

export function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2);
}
