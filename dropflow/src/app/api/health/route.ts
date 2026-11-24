import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await queryOne("select 1");
    const pending = await queryOne<{ n: string }>("select count(*) as n from jobs where status = 'queued' and run_at < now() - interval '15 minutes'");
    return NextResponse.json({ ok: true, database: "ok", delayedJobs: Number(pending?.n ?? 0) });
  } catch {
    return NextResponse.json({ ok: false, database: "indisponível" }, { status: 503 });
  }
}
