"use server";

import { revalidatePath } from "next/cache";
import { run, str } from "@/lib/actions";
import { assertPermission } from "@/modules/auth/session";
import { fetchSupplierCatalog, importFileToCatalog, importStagedItems, syncSupplierStock } from "@/modules/catalog/service";
import { FIELD_LABELS, type ColumnMapping, type Field } from "@/modules/catalog/mapping";
import { MAX_IMPORT_BYTES } from "@/modules/catalog/parsers";
import type { ActionResult } from "@/components/action-form";

export async function uploadCatalogAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("import.run");
    const supplierId = str(form, "supplierId");
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("Selecione um arquivo.");
    if (file.size > MAX_IMPORT_BYTES) throw new Error("Arquivo maior que 15 MB.");
    const mapping: ColumnMapping = {};
    for (const f of Object.keys(FIELD_LABELS) as Field[]) {
      const v = str(form, `map_${f}`);
      if (v) mapping[f] = v;
    }
    const r = await importFileToCatalog(supplierId, file.name, await file.arrayBuffer(), { mapping, weightUnit: str(form, "weightUnit") === "g" ? "g" : "kg" }, user.id);
    revalidatePath("/importar");
    const errs = r.errors.slice(0, 15).map((e) => `• Linha ${e.row}${e.sku ? ` (${e.sku})` : ""}: ${e.message}`).join("\n");
    if (!r.staged) throw new Error(`Nenhum produto válido encontrado.\nColunas lidas: ${r.headers.join(", ") || "nenhuma"}\n${errs}`);
    return `${r.staged} produto(s) lidos e prontos para importar.${r.errors.length ? `\n${r.errors.length} aviso(s)/erro(s):\n${errs}` : ""}`;
  });
}

export async function fetchCatalogAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("import.run");
    const r = await fetchSupplierCatalog(str(form, "supplierId"), user.id);
    revalidatePath("/importar");
    return `${r.staged} produto(s) recebidos da integração do fornecedor.${r.errors.length ? ` ${r.errors.length} com erro.` : ""}`;
  });
}

export async function importSelectedAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertPermission("import.run");
    const supplierId = str(form, "supplierId");
    const all = str(form, "mode") === "all";
    const skus = form.getAll("sku").map(String).filter(Boolean);
    if (!all && !skus.length) throw new Error("Selecione ao menos um produto.");
    const r = await importStagedItems(supplierId, all ? "all" : skus, user.id);
    revalidatePath("/importar");
    revalidatePath("/produtos");
    return `Importação concluída: ${r.created} novo(s), ${r.updated} atualizado(s).${r.errors.length ? `\nErros:\n${r.errors.map((e) => `• ${e.sku}: ${e.message}`).join("\n")}` : ""}`;
  });
}

export async function syncStockAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    await assertPermission("import.run");
    const r = await syncSupplierStock(str(form, "supplierId"));
    revalidatePath("/produtos");
    return `Estoque consultado para ${r.variants} SKU(s); ${r.changedProducts} produto(s) com alteração.`;
  });
}
