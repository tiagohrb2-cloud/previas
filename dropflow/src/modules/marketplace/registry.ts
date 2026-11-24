import { queryOne, type Queryable } from "@/lib/db";
import { getMode } from "@/lib/settings";
import { mercadoLivreAdapter } from "./mercadolivre/adapter";
import { simulatedMarketplace } from "./simulated";
import { MarketplaceError, type MarketplaceAccount, type MarketplaceAdapter, type MarketplaceId } from "./types";

export function getMarketplace(id: MarketplaceId): MarketplaceAdapter {
  return id === "mercadolivre" ? mercadoLivreAdapter : simulatedMarketplace;
}

/** Marketplace + conta do modo atual. Modo teste => simulado; produção => conta ML ativa. */
export async function activeMarketplaceContext(client?: Queryable): Promise<{ adapter: MarketplaceAdapter; account: MarketplaceAccount }> {
  const mode = await getMode(client);
  if (mode === "test") return { adapter: simulatedMarketplace, account: { accountId: null, externalUserId: "SIMULATED" } };
  const acc = await queryOne<{ id: string; ml_user_id: string }>(
    "select id, ml_user_id from ml_accounts where status = 'active' order by updated_at desc limit 1",
    [],
    client,
  );
  if (!acc) throw new MarketplaceError("Nenhuma conta do Mercado Livre conectada. Conecte em Configurações > Mercado Livre.");
  return { adapter: mercadoLivreAdapter, account: { accountId: acc.id, externalUserId: String(acc.ml_user_id) } };
}

export async function marketplaceContextFor(marketplace: MarketplaceId, accountId: string | null) {
  if (marketplace === "simulated") return { adapter: simulatedMarketplace, account: { accountId: null, externalUserId: "SIMULATED" } };
  const acc = accountId
    ? await queryOne<{ id: string; ml_user_id: string }>("select id, ml_user_id from ml_accounts where id = $1", [accountId])
    : await queryOne<{ id: string; ml_user_id: string }>("select id, ml_user_id from ml_accounts where status='active' order by updated_at desc limit 1");
  if (!acc) throw new MarketplaceError("Conta do Mercado Livre não encontrada");
  return { adapter: mercadoLivreAdapter, account: { accountId: acc.id, externalUserId: String(acc.ml_user_id) } };
}
