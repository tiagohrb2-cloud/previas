import { NextResponse, type NextRequest } from "next/server";

/**
 * Proteção de rotas (camada 1): sem cookie de sessão, redireciona ao login.
 * A validação real da sessão e das permissões é feita no servidor em cada
 * página/ação (requireUser / assertPermission) — camada 2.
 */
const PUBLIC = ["/login", "/setup", "/api/webhooks", "/api/cron", "/api/health", "/api/ml/oauth/callback"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (!req.cookies.get("df_session")?.value) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
