"use server";

import { revalidatePath } from "next/cache";
import { run, str } from "@/lib/actions";
import { assertPermission } from "@/modules/auth/session";
import { importRemoteListings, linkListingToProduct, setListingStatus, syncListing } from "@/modules/listings/service";
import type { ActionResult } from "@/components/action-form";

export async function importListingsAction(_: ActionResult): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("listings.publish");
    const r = await importRemoteListings(user.id);
    revalidatePath("/anuncios");
    return `${r.imported} anúncio(s) importado(s); ${r.linked} vinculado(s) automaticamente por SKU.`;
  });
}

export async function syncListingAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    await assertPermission("listings.publish");
    await syncListing(str(form, "listingId"));
    revalidatePath("/anuncios");
    return "Estoque e preço enviados ao marketplace.";
  });
}

export async function statusListingAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("listings.publish");
    await setListingStatus(str(form, "listingId"), str(form, "status") === "active" ? "active" : "paused", user.id);
    revalidatePath("/anuncios");
    return "Status do anúncio atualizado.";
  });
}

export async function linkListingAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("listings.publish");
    const productId = str(form, "productId");
    if (!/^[0-9a-f-]{36}$/.test(productId)) throw new Error("Selecione o produto");
    await linkListingToProduct(str(form, "listingId"), productId, user.id);
    revalidatePath("/anuncios");
    return "Anúncio vinculado ao produto.";
  });
}
