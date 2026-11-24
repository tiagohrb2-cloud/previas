"use server";

import { revalidatePath } from "next/cache";
import { run, str } from "@/lib/actions";
import { assertPermission } from "@/modules/auth/session";
import { processQueue } from "@/modules/worker/handlers";
import { simulateCancel, simulateClaim, simulateSale, simulateShipment, simulateSupplierStock } from "@/modules/simulator/service";
import type { ActionResult } from "@/components/action-form";

async function after(msg: string) {
  // processa a fila na hora para o resultado aparecer imediatamente
  for (let i = 0; i < 5; i++) {
    const r = await processQueue(50);
    if (!r.done && !r.failed) break;
  }
  revalidatePath("/", "layout");
  return msg;
}

export async function saleAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("simulator.use");
    const [listingId, variation] = str(form, "listing").split("|");
    const id = await simulateSale({ listingId, variationExternalId: variation || null, quantity: Number(str(form, "quantity") || 1), buyerName: str(form, "buyer") || undefined }, user.id);
    return after(`Venda simulada nº ${id} criada e processada pelo mesmo fluxo de produção.`);
  });
}

export async function shipmentAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("simulator.use");
    await simulateShipment(str(form, "shipmentId"), str(form, "step") as "shipped", user.id);
    return after("Evento de envio simulado.");
  });
}

export async function claimAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("simulator.use");
    await simulateClaim(str(form, "orderId"), str(form, "type") === "return" ? "return" : "claim", user.id);
    return after("Reclamação/devolução simulada.");
  });
}

export async function cancelAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("simulator.use");
    await simulateCancel(str(form, "orderId"), user.id);
    return after("Cancelamento simulado.");
  });
}

export async function stockAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("simulator.use");
    await simulateSupplierStock(str(form, "sku"), Number(str(form, "stock")), user.id);
    return "Estoque do fornecedor simulado alterado. Use “Atualizar estoque” em Importar produtos para sincronizar.";
  });
}

export async function runQueueAction(_: ActionResult): Promise<ActionResult> {
  return run(async () => {
    await assertPermission("simulator.use");
    const r = await processQueue(100);
    revalidatePath("/", "layout");
    return `Fila processada: ${r.done} tarefa(s) concluída(s), ${r.failed} com falha.`;
  });
}
