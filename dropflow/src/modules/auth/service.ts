import { query, queryOne } from "@/lib/db";
import { hashPassword, randomToken, sha256, verifyPassword } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import type { Role } from "./permissions";
import { z } from "zod";

export const SESSION_COOKIE = "df_session";
export const SESSION_TTL_HOURS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_WINDOW_MINUTES = 15;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export const passwordSchema = z
  .string()
  .min(10, "A senha deve ter pelo menos 10 caracteres")
  .regex(/[a-zA-Z]/, "A senha deve conter letras")
  .regex(/\d/, "A senha deve conter números");

export const newUserSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("E-mail inválido")),
  name: z.string().trim().min(2, "Informe o nome"),
  password: passwordSchema,
  role: z.enum(["admin", "operator", "viewer"]),
});

export async function countUsers(): Promise<number> {
  const r = await queryOne<{ n: string }>("select count(*) as n from users");
  return Number(r?.n ?? 0);
}

export async function createUser(input: z.input<typeof newUserSchema>, createdBy: string | null) {
  const data = newUserSchema.parse(input);
  const hash = await hashPassword(data.password);
  const user = await queryOne<{ id: string }>(
    "insert into users(email, name, password_hash, role) values ($1,$2,$3,$4) returning id",
    [data.email, data.name, hash, data.role],
  );
  await audit({ userId: createdBy, action: "user.create", entityType: "user", entityId: user!.id, details: { email: data.email, role: data.role } });
  return user!.id;
}

export type LoginResult = { ok: true; token: string; user: SessionUser } | { ok: false; error: string };

export async function login(emailRaw: string, password: string, ip: string | null, userAgent: string | null): Promise<LoginResult> {
  const email = emailRaw.trim().toLowerCase();
  const failed = await queryOne<{ n: string }>(
    `select count(*) as n from login_attempts
     where email = $1 and success = false and created_at > now() - ($2 || ' minutes')::interval`,
    [email, String(LOCK_WINDOW_MINUTES)],
  );
  if (Number(failed?.n ?? 0) >= MAX_FAILED_ATTEMPTS) {
    return { ok: false, error: `Muitas tentativas. Aguarde ${LOCK_WINDOW_MINUTES} minutos e tente novamente.` };
  }
  const user = await queryOne<SessionUser & { password_hash: string; active: boolean }>(
    "select id, email, name, role, password_hash, active from users where email = $1",
    [email],
  );
  const valid = user && user.active && (await verifyPassword(password, user.password_hash));
  await query("insert into login_attempts(email, ip, success) values ($1,$2,$3)", [email, ip, Boolean(valid)]);
  if (!valid || !user) {
    return { ok: false, error: "E-mail ou senha inválidos." };
  }
  const token = randomToken(32);
  await query(
    `insert into sessions(id, user_id, expires_at, ip, user_agent)
     values ($1, $2, now() + ($3 || ' hours')::interval, $4, $5)`,
    [sha256(token), user.id, String(SESSION_TTL_HOURS), ip, userAgent?.slice(0, 300) ?? null],
  );
  await query("update users set last_login_at = now() where id = $1", [user.id]);
  await audit({ userId: user.id, action: "auth.login", ip });
  return { ok: true, token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
}

export async function userFromSessionToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  return queryOne<SessionUser>(
    `select u.id, u.email, u.name, u.role from sessions s join users u on u.id = s.user_id
     where s.id = $1 and s.expires_at > now() and u.active`,
    [sha256(token)],
  );
}

export async function logout(token: string | undefined | null) {
  if (!token) return;
  await query("delete from sessions where id = $1", [sha256(token)]);
}

export async function changePassword(userId: string, current: string, next: string) {
  const user = await queryOne<{ password_hash: string }>("select password_hash from users where id = $1", [userId]);
  if (!user || !(await verifyPassword(current, user.password_hash))) throw new Error("Senha atual incorreta.");
  const hash = await hashPassword(passwordSchema.parse(next));
  await query("update users set password_hash = $2 where id = $1", [userId, hash]);
  await query("delete from sessions where user_id = $1", [userId]);
  await audit({ userId, action: "auth.password_change", entityType: "user", entityId: userId });
}
