import { env } from "@/lib/env";
import { MarketplaceError } from "../types";
import { getAccessToken } from "./oauth";

/**
 * Cliente HTTP da API oficial do Mercado Livre.
 * Repete automaticamente em 429/5xx com backoff; 401 força renovação do token.
 */
export async function mlRequest<T = unknown>(
  accountId: string | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  opts: { body?: unknown; headers?: Record<string, string>; retries?: number; auth?: boolean } = {},
): Promise<T> {
  const url = new URL(path, env().ML_API_URL);
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = { Accept: "application/json", ...(opts.headers ?? {}) };
    if (opts.auth !== false) {
      if (!accountId) throw new MarketplaceError("Nenhuma conta do Mercado Livre conectada");
      headers.Authorization = `Bearer ${await getAccessToken(accountId)}`;
    }
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: AbortSignal.timeout(20000) });
    } catch (e) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      throw new MarketplaceError(`Falha de conexão com o Mercado Livre: ${(e as Error).message}`, undefined, true);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get("retry-after")) || 0;
      await new Promise((r) => setTimeout(r, Math.max(retryAfter * 1000, 500 * 2 ** attempt)));
      continue;
    }
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const d = (data ?? {}) as { message?: string; error?: string; cause?: { message?: string; code?: string }[] };
      const causes = (d.cause ?? []).map((c) => c.message ?? c.code).filter(Boolean).join("; ");
      throw new MarketplaceError(
        `Mercado Livre (${res.status}): ${d.message ?? d.error ?? "erro"}${causes ? ` — ${causes}` : ""}`,
        res.status,
        res.status === 429 || res.status >= 500,
        data,
      );
    }
    return data as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}
