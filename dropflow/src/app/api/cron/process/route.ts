import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { enqueue } from "@/lib/jobs";
import { processQueue } from "@/modules/worker/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Processa a fila de tarefas. Para hospedagens sem processo contínuo (ex.: Vercel),
 * agende chamadas a esta rota com o cabeçalho Authorization: Bearer CRON_SECRET.
 */
async function handle(req: NextRequest) {
  const secret = env().CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  await enqueue("maintenance.periodic", {}, { dedupeKey: "maintenance.periodic" });
  const result = await processQueue(100);
  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
