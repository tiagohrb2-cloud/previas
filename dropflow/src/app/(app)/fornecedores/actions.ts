"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { run, str } from "@/lib/actions";
import { assertPermission } from "@/modules/auth/session";
import { createSupplier, saveIntegration, setLogisticsVerified, testIntegration, updateSupplier, type SupplierInput } from "@/modules/suppliers/service";
import type { IntegrationType } from "@/modules/suppliers/adapters/types";
import type { ActionResult } from "@/components/action-form";

function supplierFromForm(form: FormData): SupplierInput {
  return {
    name: str(form, "name"),
    legal_name: str(form, "legal_name"),
    cnpj: str(form, "cnpj"),
    contact_name: str(form, "contact_name"),
    email: str(form, "email"),
    phone: str(form, "phone"),
    address: {
      street: str(form, "street"), number: str(form, "number"), district: str(form, "district"),
      city: str(form, "city"), state: str(form, "state"), zip: str(form, "zip"),
    },
    avg_dispatch_days: Number(str(form, "avg_dispatch_days") || 2),
    confirmation_timeout_hours: Number(str(form, "confirmation_timeout_hours") || 24),
    order_channel_notes: str(form, "order_channel_notes"),
    notes: str(form, "notes"),
    active: form.get("active") !== null ? str(form, "active") === "on" : true,
  };
}

export async function createSupplierAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  let id = "";
  const r = await run(async () => {
    const user = await assertPermission("suppliers.edit");
    id = await createSupplier(supplierFromForm(form), user.id);
  });
  if (!r?.ok) return r;
  redirect(`/fornecedores/${id}?novo=1`);
}

export async function updateSupplierAction(id: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("suppliers.edit");
    await updateSupplier(id, { ...supplierFromForm(form), active: str(form, "active") === "on" }, user.id);
    revalidatePath(`/fornecedores/${id}`);
    return "Dados do fornecedor salvos.";
  });
}

export async function saveIntegrationAction(id: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("integrations.manage");
    const type = str(form, "integration_type") as IntegrationType;
    let config: Record<string, unknown> = {};
    if (type === "rest") {
      const fieldMap: Record<string, string> = {};
      for (const f of ["sku", "parentSku", "title", "description", "brand", "gtin", "cost", "stock", "weight", "length", "width", "height", "images", "color", "size", "category"]) {
        const v = str(form, `fm_${f}`);
        if (v) fieldMap[f] = v;
      }
      let statusMap: Record<string, string> = {};
      if (str(form, "statusMap")) {
        try {
          statusMap = JSON.parse(str(form, "statusMap"));
        } catch {
          throw new Error('Mapa de status deve ser JSON, ex.: {"PAGO":"confirmed","ENVIADO":"dispatched"}');
        }
      }
      const opt = (k: string) => str(form, k) || undefined;
      config = {
        baseUrl: str(form, "baseUrl"),
        documentationUrl: str(form, "documentationUrl"),
        auth: {
          type: str(form, "authType") || "bearer",
          headerName: str(form, "authType") === "query" ? undefined : opt("authHeaderName"),
          queryParam: str(form, "authType") === "query" ? opt("authHeaderName") : undefined,
        },
        timeoutMs: 15000,
        catalog: str(form, "catalogPath")
          ? { path: str(form, "catalogPath"), itemsPath: str(form, "itemsPath"), pageParam: opt("pageParam"), pageSizeParam: opt("pageSizeParam"), pageSize: Number(str(form, "pageSize") || 100), nextCursorPath: opt("nextCursorPath"), fieldMap, weightUnit: str(form, "weightUnit") === "g" ? "g" : "kg" }
          : undefined,
        stock: str(form, "stockPath")
          ? { path: str(form, "stockPath"), itemsPath: str(form, "stockItemsPath"), skuField: str(form, "stockSkuField"), quantityField: str(form, "stockQtyField") }
          : undefined,
        orders: str(form, "orderCreatePath")
          ? { createPath: str(form, "orderCreatePath"), idempotencyHeader: str(form, "idempotencyHeader") || "Idempotency-Key", responseIdPath: str(form, "responseIdPath"), responseStatusPath: opt("responseStatusPath"), statusPath: opt("statusPath"), statusField: opt("statusField"), statusMap }
          : undefined,
      };
    }
    await saveIntegration(id, type, config, { token: str(form, "secret_token"), username: str(form, "secret_username"), password: str(form, "secret_password") }, user.id);
    revalidatePath(`/fornecedores/${id}`);
    return type === "rest" ? "Integração salva. Clique em Testar conexão para verificar." : "Método de integração salvo.";
  });
}

export async function testIntegrationAction(id: string, _: ActionResult): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("integrations.manage");
    const r = await testIntegration(id, user.id);
    revalidatePath(`/fornecedores/${id}`);
    if (!r.ok) throw new Error(r.message);
    return r.message;
  });
}

export async function logisticsAction(id: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("integrations.manage");
    const verified = str(form, "verified") === "1";
    await setLogisticsVerified(id, verified, user.id);
    revalidatePath(`/fornecedores/${id}`);
    return verified ? "Fluxo logístico marcado como comprovado." : "Comprovação logística removida.";
  });
}
