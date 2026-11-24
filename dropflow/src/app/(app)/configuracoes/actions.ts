"use server";

import { revalidatePath } from "next/cache";
import { run, str } from "@/lib/actions";
import { query, queryOne } from "@/lib/db";
import { audit } from "@/lib/audit";
import { parseBRL } from "@/lib/money";
import { getSettings, setSetting } from "@/lib/settings";
import { productionReadiness } from "@/modules/settings/readiness";
import { assertPermission } from "@/modules/auth/session";
import { changePassword, createUser } from "@/modules/auth/service";
import { canAutoForward, type SupplierRow } from "@/modules/suppliers/service";
import { saveFeeProfile, savePricingRule } from "@/modules/pricing/service";
import { marketplaceContextFor } from "@/modules/marketplace/registry";
import { disconnectAccount } from "@/modules/marketplace/mercadolivre/oauth";
import type { ActionResult } from "@/components/action-form";

export async function setModeAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("settings.edit");
    const mode = str(form, "mode") === "production" ? "production" : "test";
    if (mode === "production") {
      const issues = await productionReadiness();
      if (issues.length) throw new Error(`Não é possível ativar o modo produção:\n• ${issues.join("\n• ")}`);
      // ao entrar em produção, automações começam desligadas e precisam ser reativadas conscientemente
      await setSetting("auto_forward_orders_enabled", false, user.id);
      await setSetting("auto_publish_enabled", false, user.id);
    }
    await setSetting("operation_mode", mode, user.id);
    await audit({ userId: user.id, action: "settings.mode", details: { mode } });
    revalidatePath("/", "layout");
    return mode === "production" ? "Modo PRODUÇÃO ativado. Automações foram desligadas por segurança: reative-as quando estiver pronto." : "Modo TESTE ativado.";
  });
}

export async function automationAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("settings.edit");
    const settings = await getSettings();
    const autoForward = form.get("auto_forward") === "on";
    const autoPublish = form.get("auto_publish") === "on";
    const autoSync = form.get("auto_sync") === "on";
    if (autoForward && !settings.auto_forward_orders_enabled && settings.operation_mode === "production") {
      const suppliers = await query<SupplierRow>("select * from suppliers where active");
      const ready = suppliers.filter((s) => canAutoForward(s, "production").ok);
      if (!ready.length) {
        throw new Error("Nenhum fornecedor tem integração de pedidos verificada E fluxo logístico comprovado. A automação completa só pode ser ativada depois dessas comprovações (veja a página de cada fornecedor).");
      }
    }
    const margin = Math.max(0, Math.floor(Number(str(form, "safety_margin") || 0)));
    const retention = Math.max(30, Math.min(1825, Math.floor(Number(str(form, "retention") || 180))));
    await setSetting("auto_forward_orders_enabled", autoForward, user.id);
    await setSetting("auto_publish_enabled", autoPublish, user.id);
    await setSetting("auto_stock_sync_enabled", autoSync, user.id);
    await setSetting("stock_safety_margin", margin, user.id);
    await setSetting("buyer_data_retention_days", retention, user.id);
    await setSetting("price_rounding", str(form, "rounding") === "ninety" ? "ninety" : "none", user.id);
    await audit({ userId: user.id, action: "settings.automation", details: { autoForward, autoPublish, autoSync, margin, retention } });
    revalidatePath("/", "layout");
    return "Configurações salvas.";
  });
}

function parseTiers(raw: string) {
  // formato: "79,00=6,25; 29,00=..." (abaixo de R$ X cobra R$ Y)
  if (!raw.trim()) return [];
  return raw.split(/[;\n]/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const [below, fee] = p.split("=").map((x) => parseBRL(x.trim()));
    if (below === null || fee === null || below === undefined || fee === undefined) throw new Error(`Faixa inválida: "${p}". Use: preço limite=tarifa (ex.: 79,00=6,50)`);
    return { below_cents: below, fee_cents: fee };
  });
}

export async function feeProfileAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("settings.edit");
    await saveFeeProfile(str(form, "id") || null, {
      name: str(form, "name"),
      listing_type_id: str(form, "listing_type_id"),
      category_id: str(form, "category_id"),
      commission_percent: Number(str(form, "commission").replace(",", ".")),
      fixed_fee_tiers: parseTiers(str(form, "tiers")),
      notes: str(form, "notes"),
    }, user.id);
    revalidatePath("/configuracoes/precificacao");
    return "Perfil de taxas salvo.";
  });
}

/** Consulta a taxa oficial no Mercado Livre (listing_prices) para um preço/categoria e mostra o resultado. */
export async function officialFeeAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    await assertPermission("settings.edit");
    const price = parseBRL(str(form, "price"));
    if (!price) throw new Error("Informe um preço de referência.");
    const { adapter, account } = await marketplaceContextFor("mercadolivre", null);
    if (!adapter.getListingFee) throw new Error("Consulta indisponível");
    const fee = await adapter.getListingFee(account, price, str(form, "listing_type_id"), str(form, "category_id"));
    return `Taxa oficial para R$ ${(price / 100).toFixed(2).replace(".", ",")} (${fee.listingTypeId}, ${str(form, "category_id")}):\n` +
      `• Tarifa de venda total: R$ ${(fee.saleFeeCents / 100).toFixed(2).replace(".", ",")}\n` +
      `• Percentual: ${fee.percentageFee ?? "não informado"}%\n• Parte fixa: ${fee.fixedFeeCents !== null ? `R$ ${(fee.fixedFeeCents / 100).toFixed(2).replace(".", ",")}` : "não informada"}\n` +
      "Use esses valores para criar/atualizar o perfil de taxas da categoria.";
  });
}

export async function pricingRuleAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("settings.edit");
    const mode = str(form, "mode") as "margin_fixed" | "margin_percent" | "fixed_price" | "multiplier";
    const raw = str(form, "value");
    const value = mode === "margin_fixed" || mode === "fixed_price" ? parseBRL(raw) ?? -1 : Number(raw.replace(",", "."));
    await savePricingRule(str(form, "id") || null, {
      name: str(form, "name"),
      mode,
      value,
      fee_profile_id: str(form, "fee_profile_id") || null,
      extra_cost_cents: parseBRL(str(form, "extra_cost") || "0") ?? 0,
      extra_cost_percent: Number((str(form, "extra_percent") || "0").replace(",", ".")),
      is_default: form.get("is_default") === "on",
    }, user.id);
    revalidatePath("/configuracoes/precificacao");
    return "Regra de preço salva.";
  });
}

export async function disconnectMlAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("integrations.manage");
    await disconnectAccount(str(form, "accountId"), user.id);
    revalidatePath("/configuracoes/mercado-livre");
    return "Conta desconectada. Remova também a autorização do aplicativo no painel do Mercado Livre, se desejar.";
  });
}

export async function createUserAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("users.manage");
    await createUser({ email: str(form, "email"), name: str(form, "name"), password: String(form.get("password") ?? ""), role: str(form, "role") as "operator" }, user.id);
    revalidatePath("/configuracoes/usuarios");
    return "Usuário criado.";
  });
}

export async function updateUserAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("users.manage");
    const id = str(form, "id");
    if (id === user.id) throw new Error("Você não pode alterar o próprio papel ou desativar a própria conta.");
    const role = str(form, "role");
    if (!["admin", "operator", "viewer"].includes(role)) throw new Error("Papel inválido");
    const active = str(form, "active") === "1";
    await query("update users set role = $2, active = $3 where id = $1", [id, role, active]);
    if (!active) await query("delete from sessions where user_id = $1", [id]);
    await audit({ userId: user.id, action: "user.update", entityType: "user", entityId: id, details: { role, active } });
    revalidatePath("/configuracoes/usuarios");
    return "Usuário atualizado.";
  });
}

export async function changePasswordAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("dashboard.view");
    if (String(form.get("next")) !== String(form.get("next2"))) throw new Error("As senhas não conferem.");
    await changePassword(user.id, String(form.get("current") ?? ""), String(form.get("next") ?? ""));
    return "Senha alterada. Todas as sessões foram encerradas; entre novamente.";
  });
}
