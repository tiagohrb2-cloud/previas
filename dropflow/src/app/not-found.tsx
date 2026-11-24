import { LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-xl font-semibold text-slate-900">Página não encontrada</h1>
      <LinkButton href="/" variant="secondary">Voltar ao painel</LinkButton>
    </div>
  );
}
