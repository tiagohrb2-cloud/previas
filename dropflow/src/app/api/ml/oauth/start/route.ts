import { NextResponse } from "next/server";
import { currentUser } from "@/modules/auth/session";
import { can } from "@/modules/auth/permissions";
import { buildAuthorizationUrl } from "@/modules/marketplace/mercadolivre/oauth";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user || !can(user.role, "integrations.manage")) return NextResponse.json({ error: "sem permissão" }, { status: 403 });
  try {
    return NextResponse.redirect(await buildAuthorizationUrl(user.id));
  } catch (e) {
    const url = new URL("/configuracoes/mercado-livre", env().APP_URL);
    url.searchParams.set("erro", (e as Error).message);
    return NextResponse.redirect(url);
  }
}
