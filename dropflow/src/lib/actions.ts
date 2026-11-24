import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import type { ActionResult } from "@/components/action-form";

/** Executa uma Server Action devolvendo mensagem amigável (sem vazar detalhes internos sensíveis). */
export async function run(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn();
    return { ok: true, message: message ?? "Salvo com sucesso." };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ZodError) return { ok: false, message: e.issues.map((i) => i.message).join("\n") };
    const msg = e instanceof Error ? e.message : "Erro inesperado";
    if (/duplicate key|unique constraint/i.test(msg)) return { ok: false, message: "Já existe um registro com esses dados." };
    if (/ECONNREFUSED|connect/i.test(msg) && /5432/.test(msg)) return { ok: false, message: "Banco de dados indisponível." };
    console.error("[action]", e);
    return { ok: false, message: msg };
  }
}

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}
