"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { countUsers, createUser, login, logout, SESSION_COOKIE, SESSION_TTL_HOURS } from "@/modules/auth/service";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { run, str } from "@/lib/actions";
import type { ActionResult } from "@/components/action-form";

async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().APP_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_HOURS * 3600,
  });
}

export async function loginAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const r = await login(str(form, "email"), String(form.get("password") ?? ""), ip, h.get("user-agent"));
  if (!r.ok) return { ok: false, message: r.error };
  await setSessionCookie(r.token);
  redirect("/");
}

export async function logoutAction() {
  const jar = await cookies();
  await logout(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

export async function setupAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const result = await run(async () => {
    const expected = env().SETUP_TOKEN;
    if (!expected) throw new Error("Defina SETUP_TOKEN no ambiente para criar o primeiro administrador.");
    if ((await countUsers()) > 0) throw new Error("O administrador já foi criado. Entre com seu e-mail e senha.");
    if (!safeEqual(str(form, "token"), expected)) throw new Error("Token de configuração inválido.");
    if (String(form.get("password")) !== String(form.get("password2"))) throw new Error("As senhas não conferem.");
    await createUser({ email: str(form, "email"), name: str(form, "name"), password: String(form.get("password")), role: "admin" }, null);
  });
  if (!result?.ok) return result;
  redirect("/login?criado=1");
}
