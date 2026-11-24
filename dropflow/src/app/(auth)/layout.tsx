export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-ink-950 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.25),transparent_45%),radial-gradient(circle_at_80%_70%,rgba(14,165,233,0.15),transparent_40%)]" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 font-bold text-white">D</div>
            <span className="text-lg font-semibold text-white">DropFlow</span>
          </div>
          <div className="max-w-md">
            <h2 className="text-3xl font-semibold leading-tight text-white">Fornecedores nacionais conectados ao seu Mercado Livre.</h2>
            <p className="mt-4 text-slate-400">Importe catálogos, publique anúncios com lucro calculado e acompanhe cada pedido do pagamento à entrega.</p>
            <ul className="mt-8 space-y-3 text-sm text-slate-300">
              <li>• Importação por API, CSV, XML e planilhas</li>
              <li>• Precificação com taxas configuráveis</li>
              <li>• Encaminhamento de pedidos sem duplicidade</li>
              <li>• Rastreamento oficial e central de problemas</li>
            </ul>
          </div>
          <p className="text-xs text-slate-600">Dados pessoais tratados conforme a LGPD.</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
