import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { countUsers } from "@/modules/auth/service";
import { setupAction } from "../actions";

export const metadata: Metadata = { title: "Configuração inicial" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if ((await countUsers()) > 0) redirect("/login");
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Criar administrador</h1>
      <p className="mt-1 text-sm text-slate-500">Informe o <code className="rounded bg-slate-100 px-1">SETUP_TOKEN</code> definido nas variáveis de ambiente. Esta página é bloqueada após o primeiro cadastro.</p>
      <ActionForm action={setupAction} className="mt-6 space-y-4">
        <Field label="Token de configuração"><Input name="token" type="password" required autoComplete="off" /></Field>
        <Field label="Nome"><Input name="name" required /></Field>
        <Field label="E-mail"><Input name="email" type="email" required /></Field>
        <Field label="Senha" hint="Mínimo de 10 caracteres, com letras e números."><Input name="password" type="password" required autoComplete="new-password" /></Field>
        <Field label="Confirmar senha"><Input name="password2" type="password" required autoComplete="new-password" /></Field>
        <SubmitButton className="w-full">Criar administrador</SubmitButton>
      </ActionForm>
    </div>
  );
}
