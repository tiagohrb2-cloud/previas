import { NextResponse, type NextRequest } from "next/server";
import { handleCallback } from "@/modules/marketplace/mercadolivre/oauth";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Retorno da autorização do Mercado Livre: ?code=...&state=... */
export async function GET(req: NextRequest) {
  const back = new URL("/configuracoes/mercado-livre", env().APP_URL);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  if (error || !code || !state) {
    back.searchParams.set("erro", error ? `Autorização negada: ${error}` : "Resposta de autorização incompleta.");
    return NextResponse.redirect(back);
  }
  try {
    await handleCallback(code, state);
    back.searchParams.set("conectado", "1");
  } catch (e) {
    back.searchParams.set("erro", (e as Error).message.slice(0, 300));
  }
  return NextResponse.redirect(back);
}
