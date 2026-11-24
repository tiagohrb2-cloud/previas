"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard, Package, Download, Truck, Store, ShoppingCart, MapPin, LifeBuoy, Wallet, Settings,
  Bell, FlaskConical, ScrollText, Menu, X, LogOut,
} from "lucide-react";
import { cn } from "./ui";

const NAV = [
  { href: "/", label: "Painel", icon: LayoutDashboard },
  { href: "/pedidos", label: "Pedidos", icon: ShoppingCart },
  { href: "/produtos", label: "Produtos", icon: Package },
  { href: "/importar", label: "Importar produtos", icon: Download },
  { href: "/anuncios", label: "Anúncios", icon: Store },
  { href: "/fornecedores", label: "Fornecedores", icon: Truck },
  { href: "/rastreamento", label: "Rastreamento", icon: MapPin },
  { href: "/problemas", label: "Problemas", icon: LifeBuoy },
  { href: "/financeiro", label: "Financeiro", icon: Wallet },
];
const NAV_BOTTOM = [
  { href: "/alertas", label: "Alertas", icon: Bell },
  { href: "/simulador", label: "Simulador", icon: FlaskConical, testOnly: true },
  { href: "/logs", label: "Registro de atividades", icon: ScrollText, adminOnly: true },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

export function AppShell({
  children, user, mode, alerts, logoutAction,
}: { children: ReactNode; user: { name: string; email: string; role: string; roleLabel: string }; mode: "test" | "production"; alerts: number; logoutAction: () => Promise<void> }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  const item = (n: { href: string; label: string; icon: typeof Bell }, badge?: number) => (
    <Link
      key={n.href}
      href={n.href}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
        isActive(n.href) ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white",
      )}
    >
      <n.icon className={cn("h-4 w-4 shrink-0", isActive(n.href) ? "text-brand-500" : "text-slate-500 group-hover:text-slate-300")} />
      <span className="truncate">{n.label}</span>
      {badge ? <span className="ml-auto rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold text-white">{badge > 99 ? "99+" : badge}</span> : null}
    </Link>
  );

  const sidebar = (
    <div className="flex h-full flex-col bg-ink-950 px-3 py-4">
      <div className="flex items-center gap-2.5 px-2 pb-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white">D</div>
        <div>
          <p className="text-sm font-semibold text-white">DropFlow</p>
          <p className="text-[11px] text-slate-500">Dropshipping nacional</p>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {NAV.map((n) => item(n))}
        <div className="my-3 border-t border-white/5" />
        {NAV_BOTTOM.filter((n) => (!n.testOnly || mode === "test") && (!n.adminOnly || user.role === "admin")).map((n) => item(n, n.href === "/alertas" ? alerts : undefined))}
      </nav>
      <div className="mt-3 rounded-lg bg-white/5 p-3">
        <p className="truncate text-sm font-medium text-white">{user.name}</p>
        <p className="truncate text-xs text-slate-500">{user.roleLabel}</p>
        <form action={logoutAction}>
          <button className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white">
            <LogOut className="h-3.5 w-3.5" /> Sair
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl">{sidebar}</aside>
          <button aria-label="Fechar menu" onClick={() => setOpen(false)} className="absolute right-4 top-4 rounded-lg bg-white/10 p-2 text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button aria-label="Abrir menu" onClick={() => setOpen(true)} className="-ml-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden">
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold text-slate-900 lg:hidden">DropFlow</span>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/configuracoes"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
                mode === "test" ? "bg-amber-50 text-amber-800 ring-amber-300" : "bg-brand-50 text-brand-800 ring-brand-300",
              )}
              title="Modo de operação"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", mode === "test" ? "bg-amber-500" : "bg-brand-500")} />
              {mode === "test" ? "MODO TESTE" : "PRODUÇÃO"}
            </Link>
            <Link href="/alertas" className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Alertas">
              <Bell className="h-5 w-5" />
              {alerts > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-500" />}
            </Link>
          </div>
        </header>
        {mode === "test" && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-900 sm:px-6">
            Modo teste: pedidos, fornecedor e marketplace simulados. Nada é enviado ao Mercado Livre nem a fornecedores reais.
          </div>
        )}
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
