"use server";

import { revalidatePath } from "next/cache";
import { run, str } from "@/lib/actions";
import { queryOne } from "@/lib/db";
import { decryptJson } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { assertPermission } from "@/modules/auth/session";
import { approveSupplierOrder, manualSupplierStatus, retryOrder, setSupplierPayment } from "@/modules/orders/processor";
import { processQueue } from "@/modules/worker/handlers";
import { createManualClaim } from "@/modules/issues/service";
import type { SupplierOrderState } from "@/modules/suppliers/adapters/types";
import type { ActionResult } from "@/components/action-form";

export async function approveAction(orderId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("orders.operate");
    await approveSupplierOrder(str(form, "supplierOrderId"), user.id);
    await processQueue(10); // envia imediatamente; o worker garante novas tentativas se falhar
    revalidatePath(`/pedidos/${orderId}`);
    return "Encaminhamento aprovado.";
  });
}

export async function retryAction(orderId: string, _: ActionResult): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("orders.operate");
    await retryOrder(orderId, user.id);
    await processQueue(10);
    revalidatePath(`/pedidos/${orderId}`);
    return "Pedido reanalisado com os dados oficiais do marketplace.";
  });
}

export async function supplierStatusAction(orderId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("orders.operate");
    const status = str(form, "status") as SupplierOrderState;
    if (!["confirmed", "preparing", "dispatched", "rejected", "cancelled"].includes(status)) throw new Error("Status inválido");
    await manualSupplierStatus(str(form, "supplierOrderId"), status, user.id, str(form, "note") || undefined);
    revalidatePath(`/pedidos/${orderId}`);
    return "Status do fornecedor atualizado.";
  });
}

export async function paymentAction(orderId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("finance.edit");
    await setSupplierPayment(str(form, "supplierOrderId"), str(form, "paid") === "1", user.id);
    revalidatePath(`/pedidos/${orderId}`);
    return "Pagamento ao fornecedor atualizado.";
  });
}

/** LGPD: dados do comprador só são exibidos sob demanda, a quem tem permissão, com registro. */
export async function revealBuyerAction(orderId: string, _: ActionResult): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("orders.view_buyer_data");
    const o = await queryOne<{ buyer_data_enc: string | null; buyer_data_purged_at: string | null }>("select buyer_data_enc, buyer_data_purged_at from orders where id = $1", [orderId]);
    if (!o) throw new Error("Pedido não encontrado");
    if (o.buyer_data_purged_at) throw new Error("Dados pessoais já removidos (prazo de retenção da LGPD).");
    const data = decryptJson<{ name?: string }>(o.buyer_data_enc);
    await audit({ userId: user.id, action: "order.buyer_data_view", entityType: "order", entityId: orderId });
    return data?.name ? `Comprador: ${data.name}` : "Sem dados pessoais armazenados para este pedido.";
  });
}

export async function manualClaimAction(orderId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("issues.operate");
    await createManualClaim({ orderId, type: str(form, "type"), reason: str(form, "reason"), dueAt: str(form, "dueAt") || null }, user.id);
    revalidatePath(`/pedidos/${orderId}`);
    return "Ocorrência registrada na central de problemas.";
  });
}
