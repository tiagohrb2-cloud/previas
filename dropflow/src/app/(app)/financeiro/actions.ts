"use server";

import { revalidatePath } from "next/cache";
import { run, str } from "@/lib/actions";
import { parseBRL } from "@/lib/money";
import { assertPermission } from "@/modules/auth/session";
import { addExpense } from "@/modules/finance/service";
import type { ActionResult } from "@/components/action-form";

export async function addExpenseAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("finance.edit");
    await addExpense({ description: str(form, "description"), category: str(form, "category") || "operational", amountCents: parseBRL(str(form, "amount")) ?? 0, incurredOn: str(form, "date") }, user.id);
    revalidatePath("/financeiro");
    return "Despesa lançada.";
  });
}
