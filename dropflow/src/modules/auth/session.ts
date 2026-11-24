import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { SESSION_COOKIE, userFromSessionToken, type SessionUser } from "./service";
import { can, type Permission } from "./permissions";

export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  return userFromSessionToken(jar.get(SESSION_COOKIE)?.value);
});

/** Exige usuário autenticado (e permissão, se informada). Redireciona ao login. */
export async function requireUser(permission?: Permission): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (permission && !can(user.role, permission)) redirect("/sem-permissao");
  return user;
}

/** Para Server Actions: lança erro em vez de redirecionar. */
export async function assertPermission(permission: Permission): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new Error("Sessão expirada. Entre novamente.");
  if (!can(user.role, permission)) throw new Error("Você não tem permissão para esta ação.");
  return user;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}
