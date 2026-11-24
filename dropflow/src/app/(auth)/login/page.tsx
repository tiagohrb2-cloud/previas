import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, Notice } from "@/components/ui";
import { currentUser } from "@/modules/auth/session";
import { countUsers } from "@/modules/auth/service";
import { loginAction } from "../actions";

export const metadata: Metadata = { title: "Entrar" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ criado?: string }> }) {
  if (await currentUser()) redirect("/");
  const sp = await searchParams;
  const noUsers = (await countUsers()) === 0;
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Entrar no DropFlow</h1>
      <p className="mt-1 text-sm text-slate-500">Acesso restrito à equipe autorizada.</p>
      {sp.criado && <div className="mt-4"><Notice tone="success">Administrador criado. Entre com seus dados.</Notice></div>}
      {noUsers && (
        <div className="mt-4">
          <Notice tone="warning" title="Primeiro acesso">
            Nenhum usuário cadastrado. <Link className="font-semibold underline" href="/setup">Criar o administrador</Link>.
          </Notice>
        </div>
      )}
      <ActionForm action={loginAction} className="mt-6 space-y-4">
        <Field label="E-mail"><Input name="email" type="email" autoComplete="username" required /></Field>
        <Field label="Senha"><Input name="password" type="password" autoComplete="current-password" required /></Field>
        <SubmitButton className="w-full">Entrar</SubmitButton>
      </ActionForm>
    </div>
  );
}
