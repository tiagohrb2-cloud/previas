import { NextResponse, after, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { ingestNotification } from "@/modules/notifications/intake";
import { processQueue } from "@/modules/worker/handlers";

export const dynamic = "force-dynamic";

/**
 * Notificações do Mercado Livre.
 * - Responde 200 rapidamente (o ML reenvia se não receber resposta).
 * - Valida a chave secreta da URL (o ML não assina as notificações).
 * - Registra a notificação de forma idempotente e enfileira o processamento.
 * - O conteúdo real é SEMPRE consultado na API oficial pelo worker.
 */
export async function POST(req: NextRequest) {
  const key = env().ML_WEBHOOK_KEY;
  if (!key) return NextResponse.json({ error: "webhook não configurado" }, { status: 503 });
  const provided = req.nextUrl.searchParams.get("key") ?? "";
  if (!safeEqual(provided, key)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const text = await req.text();
  if (text.length > 20_000) return NextResponse.json({ error: "payload grande demais" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  try {
    const result = await ingestNotification(body, "mercadolivre");
    if (result.status === "queued") {
      after(async () => {
        await processQueue(10).catch((e) => console.error("[webhook] processamento", e));
      });
    }
    return NextResponse.json({ ok: true, status: result.status });
  } catch (e) {
    console.error("[webhook]", e);
    // payload malformado: 200 evita reenvios infinitos de algo que nunca será válido
    return NextResponse.json({ ok: false, error: "notificação inválida" }, { status: 200 });
  }
}
