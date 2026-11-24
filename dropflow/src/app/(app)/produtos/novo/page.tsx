import { Card, Field, Input, PageHeader, Select, Textarea, EmptyState, LinkButton } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { requireUser } from "@/modules/auth/session";
import { query } from "@/lib/db";
import { createProductAction } from "../actions";

export default async function NewProduct() {
  await requireUser("products.edit");
  const suppliers = await query<{ id: string; name: string }>("select id, name from suppliers where active order by name");
  if (!suppliers.length) {
    return (
      <>
        <PageHeader back={{ href: "/produtos", label: "Produtos" }} title="Cadastrar produto" />
        <EmptyState title="Cadastre um fornecedor primeiro" description="Todo produto precisa estar associado ao fornecedor que fará o envio." action={<LinkButton href="/fornecedores/novo">Novo fornecedor</LinkButton>} />
      </>
    );
  }
  return (
    <>
      <PageHeader back={{ href: "/produtos", label: "Produtos" }} title="Cadastrar produto manualmente" description="Use quando o fornecedor não oferece API nem arquivo. Para variações (cor/tamanho), prefira a importação por planilha." />
      <Card>
        <ActionForm action={createProductAction} className="grid gap-4 sm:grid-cols-2">
          <Field label="Fornecedor"><Select name="supplierId" required>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="SKU do fornecedor"><Input name="sku" required /></Field>
          <Field label="Nome" className="sm:col-span-2"><Input name="title" required minLength={3} /></Field>
          <Field label="Descrição" className="sm:col-span-2"><Textarea name="description" rows={5} /></Field>
          <Field label="Marca"><Input name="brand" /></Field>
          <Field label="Código de barras (EAN)"><Input name="gtin" inputMode="numeric" /></Field>
          <Field label="Preço de custo (R$)"><Input name="cost" inputMode="decimal" required placeholder="0,00" /></Field>
          <Field label="Estoque disponível"><Input name="stock" type="number" min={0} defaultValue={0} /></Field>
          <Field label="Peso (kg)"><Input name="weight" inputMode="decimal" /></Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Compr. (cm)"><Input name="length" inputMode="decimal" /></Field>
            <Field label="Larg. (cm)"><Input name="width" inputMode="decimal" /></Field>
            <Field label="Alt. (cm)"><Input name="height" inputMode="decimal" /></Field>
          </div>
          <Field label="Fotos (URLs, uma por linha)" className="sm:col-span-2" hint="Links públicos das imagens fornecidas pelo fornecedor."><Textarea name="images" rows={3} /></Field>
          <div className="sm:col-span-2"><SubmitButton>Cadastrar produto</SubmitButton></div>
        </ActionForm>
      </Card>
    </>
  );
}
