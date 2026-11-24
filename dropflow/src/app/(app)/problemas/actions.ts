"use server";

import { revalidatePath } from "next/cache";
import { run, str } from "@/lib/actions";
import { assertPermission } from "@/modules/auth/session";
import { addClaimNote, setClaimStatus, updateReturn } from "@/modules/issues/service";
import type { ActionResult } from "@/components/action-form";

export async function noteAction(claimId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("issues.operate");
    await addClaimNote(claimId, str(form, "message"), user.id);
    revalidatePath(`/problemas/${claimId}`);
    return "Anotação registrada no histórico.";
  });
}

export async function claimStatusAction(claimId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("issues.operate");
    await setClaimStatus(claimId, str(form, "status"), str(form, "resolution") || null, user.id);
    revalidatePath(`/problemas/${claimId}`);
    return "Status interno atualizado. Ações no Mercado Livre (reembolso, cancelamento, resposta) devem ser feitas no próprio marketplace.";
  });
}

export async function returnAction(claimId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("issues.operate");
    await updateReturn(str(form, "returnId"), str(form, "status"), str(form, "notes") || null, str(form, "tracking") || null, user.id);
    revalidatePath(`/problemas/${claimId}`);
    return "Devolução atualizada.";
  });
}
