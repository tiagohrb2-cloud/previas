import { Card, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/modules/auth/session";
import { SupplierFields } from "../supplier-form";
import { createSupplierAction } from "../actions";

export default async function NewSupplier() {
  await requireUser("suppliers.edit");
  return (
    <>
      <PageHeader back={{ href: "/fornecedores", label: "Fornecedores" }} title="Novo fornecedor" description="Depois de salvar, configure o método de integração (API, arquivo ou manual)." />
      <Card><ActionForm action={createSupplierAction}><SupplierFields /></ActionForm></Card>
    </>
  );
}
