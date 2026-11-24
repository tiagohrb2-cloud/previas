import { env } from "@/lib/env";
import { decrypt, encrypt, pkcePair, randomToken } from "@/lib/crypto";
import { query, queryOne, tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { MarketplaceError } from "../types";

/**
 * OAuth 2.0 (Authorization Code + PKCE) com o Mercado Livre.
 * - O usuário é enviado à página oficial de autorização do ML.
 * - O ML redireciona para APP_URL/api/ml/oauth/callback com ?code&state.
 * - Trocamos o code por access_token/refresh_token no servidor.
 * Tokens ficam criptografados (AES-256-GCM) na tabela ml_accounts.
 */
export function redirectUri() {
  return new URL("/api/ml/oauth/callback", env().APP_URL).toString();
}

export async function buildAuthorizationUrl(userId: string): Promise<string> {
  const e = env();
  if (!e.ML_CLIENT_ID || !e.ML_CLIENT_SECRET) throw new Error("Configure ML_CLIENT_ID e ML_CLIENT_SECRET antes de conectar.");
  const state = randomToken(24);
  const { verifier, challenge } = pkcePair();
  await query("delete from oauth_states where created_at < now() - interval '1 hour'");
  await query("insert into oauth_states(state, code_verifier_enc, user_id) values ($1,$2,$3)", [state, encrypt(verifier), userId]);
  const url = new URL(e.ML_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", e.ML_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  user_id: number;
  refresh_token?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const e = env();
  const res = await fetch(new URL("/oauth/token", e.ML_API_URL), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new MarketplaceError(`Mercado Livre recusou o token: ${data.message ?? data.error ?? res.status}`, res.status, res.status >= 500, data);
  }
  return data as TokenResponse;
}

/** Troca o code do callback por tokens e salva/atualiza a conta. */
export async function handleCallback(code: string, state: string) {
  const e = env();
  const st = await queryOne<{ code_verifier_enc: string; user_id: string; created_at: string }>(
    "delete from oauth_states where state = $1 and created_at > now() - interval '15 minutes' returning code_verifier_enc, user_id, created_at",
    [state],
  );
  if (!st) throw new Error("Solicitação de autorização inválida ou expirada. Tente conectar novamente.");
  const token = await tokenRequest({
    grant_type: "authorization_code",
    client_id: e.ML_CLIENT_ID!,
    client_secret: e.ML_CLIENT_SECRET!,
    code,
    redirect_uri: redirectUri(),
    code_verifier: decrypt(st.code_verifier_enc),
  });
  let nickname: string | null = null;
  try {
    const me = await fetch(new URL("/users/me", e.ML_API_URL), { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10000) });
    if (me.ok) nickname = (await me.json()).nickname ?? null;
  } catch {
    /* apelido é opcional */
  }
  const row = await queryOne<{ id: string }>(
    `insert into ml_accounts(ml_user_id, nickname, access_token_enc, refresh_token_enc, token_expires_at, scopes, status, connected_by, last_error)
     values ($1,$2,$3,$4, now() + ($5 || ' seconds')::interval, $6, 'active', $7, null)
     on conflict (ml_user_id) do update set nickname = coalesce(excluded.nickname, ml_accounts.nickname),
       access_token_enc = excluded.access_token_enc, refresh_token_enc = coalesce(excluded.refresh_token_enc, ml_accounts.refresh_token_enc),
       token_expires_at = excluded.token_expires_at, scopes = excluded.scopes, status = 'active', last_error = null
     returning id`,
    [token.user_id, nickname, encrypt(token.access_token), token.refresh_token ? encrypt(token.refresh_token) : null, String(token.expires_in), token.scope ?? null, st.user_id],
  );
  await audit({ userId: st.user_id, action: "ml.account_connected", entityType: "ml_account", entityId: row!.id, details: { mlUserId: token.user_id, nickname } });
  return row!.id;
}

/**
 * Retorna um access_token válido, renovando quando faltar menos de 5 minutos.
 * A renovação usa lock na linha para que dois processos não gastem o mesmo
 * refresh_token (o ML pode invalidar o refresh_token após o uso).
 */
export async function getAccessToken(accountId: string): Promise<string> {
  const acc = await queryOne<{ access_token_enc: string; token_expires_at: string; status: string }>(
    "select access_token_enc, token_expires_at, status from ml_accounts where id = $1",
    [accountId],
  );
  if (!acc) throw new MarketplaceError("Conta do Mercado Livre não encontrada");
  if (acc.status === "revoked") throw new MarketplaceError("Autorização do Mercado Livre revogada. Conecte a conta novamente.");
  if (new Date(acc.token_expires_at).getTime() - Date.now() > 5 * 60 * 1000) return decrypt(acc.access_token_enc);

  const result = await tx(async (c): Promise<{ token: string } | { error: unknown }> => {
    const locked = (await c.query("select access_token_enc, refresh_token_enc, token_expires_at from ml_accounts where id = $1 for update", [accountId])).rows[0];
    if (new Date(locked.token_expires_at).getTime() - Date.now() > 5 * 60 * 1000) return { token: decrypt(locked.access_token_enc) };
    if (!locked.refresh_token_enc) return { error: new MarketplaceError("Sem refresh_token. Conecte a conta novamente.", 401) };
    const e = env();
    try {
      const token = await tokenRequest({
        grant_type: "refresh_token",
        client_id: e.ML_CLIENT_ID!,
        client_secret: e.ML_CLIENT_SECRET!,
        refresh_token: decrypt(locked.refresh_token_enc),
      });
      await c.query(
        `update ml_accounts set access_token_enc=$2, refresh_token_enc=coalesce($3, refresh_token_enc),
           token_expires_at = now() + ($4 || ' seconds')::interval, status='active', last_error=null where id=$1`,
        [accountId, encrypt(token.access_token), token.refresh_token ? encrypt(token.refresh_token) : null, String(token.expires_in)],
      );
      return { token: token.access_token };
    } catch (err) {
      return { error: err };
    }
  });
  if ("token" in result) return result.token;
  const err = result.error;
  const status = err instanceof MarketplaceError ? err.status : undefined;
  // fora da transação, para o registro do erro não ser desfeito
  await query("update ml_accounts set status=$2, last_error=$3 where id=$1", [
    accountId, status === 400 || status === 401 ? "revoked" : "error", (err as Error).message.slice(0, 500),
  ]);
  throw err;
}

export async function disconnectAccount(accountId: string, userId: string) {
  await query("update ml_accounts set status='revoked', access_token_enc='', refresh_token_enc=null where id=$1", [accountId]);
  await audit({ userId, action: "ml.account_disconnected", entityType: "ml_account", entityId: accountId });
}
