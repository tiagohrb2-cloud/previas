import { LinkButton } from "@/components/ui";

export default function NoPermission() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold text-slate-900">Acesso não permitido</h1>
      <p className="max-w-sm text-sm text-slate-500">Seu perfil não tem permissão para esta área. Fale com o administrador.</p>
      <LinkButton href="/" variant="secondary">Voltar ao painel</LinkButton>
    </div>
  );
}
