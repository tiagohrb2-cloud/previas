import { Card, Field, Input, DescList } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { requireUser } from "@/modules/auth/session";
import { ROLE_LABELS } from "@/modules/auth/permissions";
import { changePasswordAction } from "../actions";

export default async function AccountSettings() {
  const user = await requireUser();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Meus dados"><DescList items={[["Nome", user.name], ["E-mail", user.email], ["Papel", ROLE_LABELS[user.role]]]} /></Card>
      <Card title="Alterar senha">
        <ActionForm action={changePasswordAction} resetOnSuccess className="space-y-3">
          <Field label="Senha atual"><Input name="current" type="password" required autoComplete="current-password" /></Field>
          <Field label="Nova senha" hint="Mínimo 10 caracteres com letras e números"><Input name="next" type="password" required autoComplete="new-password" /></Field>
          <Field label="Confirmar nova senha"><Input name="next2" type="password" required autoComplete="new-password" /></Field>
          <SubmitButton>Alterar senha</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
