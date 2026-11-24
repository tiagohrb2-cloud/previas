import { queryOne } from "@/lib/db";
import { isMercadoLivreConfigured } from "@/lib/env";

/** Pendências que impedem o modo produção. */
export async function productionReadiness() {
  const issues: string[] = [];
  if (!isMercadoLivreConfigured()) issues.push("Credenciais do aplicativo do Mercado Livre (ML_CLIENT_ID / ML_CLIENT_SECRET) não configuradas.");
  if (!(await queryOne("select 1 from ml_accounts where status = 'active'"))) issues.push("Nenhuma conta do Mercado Livre conectada.");
  if (!(await queryOne("select 1 from suppliers where active and integration_type <> 'simulated'"))) issues.push("Nenhum fornecedor real cadastrado.");
  if (!(await queryOne("select 1 from fee_profiles"))) issues.push("Nenhum perfil de taxas do marketplace cadastrado.");
  return issues;
}
