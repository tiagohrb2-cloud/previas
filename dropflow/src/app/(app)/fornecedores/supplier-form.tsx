import { Field, Input, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/action-form";
import type { SupplierRow } from "@/modules/suppliers/service";

export function SupplierFields({ s, disabled }: { s?: Partial<SupplierRow>; disabled?: boolean }) {
  const a = (s?.address ?? {}) as Record<string, string>;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Nome do fornecedor *"><Input name="name" defaultValue={s?.name} required disabled={disabled} /></Field>
      <Field label="Razão social"><Input name="legal_name" defaultValue={s?.legal_name ?? ""} disabled={disabled} /></Field>
      <Field label="CNPJ" hint="Validado pelos dígitos verificadores"><Input name="cnpj" defaultValue={s?.cnpj ?? ""} inputMode="numeric" disabled={disabled} /></Field>
      <Field label="Contato"><Input name="contact_name" defaultValue={s?.contact_name ?? ""} disabled={disabled} /></Field>
      <Field label="E-mail"><Input name="email" type="email" defaultValue={s?.email ?? ""} disabled={disabled} /></Field>
      <Field label="Telefone / WhatsApp"><Input name="phone" defaultValue={s?.phone ?? ""} inputMode="tel" disabled={disabled} /></Field>
      <div className="grid grid-cols-3 gap-2 sm:col-span-2">
        <Field label="Endereço" className="col-span-2"><Input name="street" defaultValue={a.street} disabled={disabled} /></Field>
        <Field label="Número"><Input name="number" defaultValue={a.number} disabled={disabled} /></Field>
        <Field label="Bairro"><Input name="district" defaultValue={a.district} disabled={disabled} /></Field>
        <Field label="Cidade"><Input name="city" defaultValue={a.city} disabled={disabled} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="UF"><Input name="state" defaultValue={a.state} maxLength={2} disabled={disabled} /></Field>
          <Field label="CEP"><Input name="zip" defaultValue={a.zip} inputMode="numeric" disabled={disabled} /></Field>
        </div>
      </div>
      <Field label="Prazo médio de despacho (dias úteis)"><Input name="avg_dispatch_days" type="number" min={0} max={60} defaultValue={s?.avg_dispatch_days ?? 2} disabled={disabled} /></Field>
      <Field label="Prazo para confirmar pedidos (horas)" hint="Após esse prazo sem confirmação, o sistema gera um alerta"><Input name="confirmation_timeout_hours" type="number" min={1} max={240} defaultValue={s?.confirmation_timeout_hours ?? 24} disabled={disabled} /></Field>
      <Field label="Como enviar pedidos a este fornecedor" className="sm:col-span-2" hint="Ex.: e-mail pedidos@…, WhatsApp, portal B2B. Exibido junto ao pedido."><Textarea name="order_channel_notes" rows={2} defaultValue={s?.order_channel_notes ?? ""} disabled={disabled} /></Field>
      <Field label="Observações" className="sm:col-span-2"><Textarea name="notes" rows={2} defaultValue={s?.notes ?? ""} disabled={disabled} /></Field>
      {s?.id && (
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="active" defaultChecked={s.active} disabled={disabled} className="h-4 w-4 accent-emerald-600" /> Fornecedor ativo</label>
      )}
      {!disabled && <div className="sm:col-span-2"><SubmitButton>{s?.id ? "Salvar dados" : "Cadastrar fornecedor"}</SubmitButton></div>}
    </div>
  );
}
