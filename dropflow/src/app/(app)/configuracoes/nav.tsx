"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  ["/configuracoes", "Geral e automação"],
  ["/configuracoes/mercado-livre", "Mercado Livre"],
  ["/configuracoes/precificacao", "Taxas e preços"],
  ["/configuracoes/usuarios", "Usuários"],
  ["/configuracoes/conta", "Minha conta"],
];

export function SettingsNav() {
  const path = usePathname();
  return (
    <nav className="table-scroll -mx-4 flex gap-1 border-b border-slate-200 px-4 sm:mx-0 sm:px-0">
      {TABS.map(([href, label]) => (
        <Link key={href} href={href} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${path === href ? "border-brand-600 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{label}</Link>
      ))}
    </nav>
  );
}
