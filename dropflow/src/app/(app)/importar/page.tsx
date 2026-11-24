import Link from "next/link";
import type { Metadata } from "next";
import { Card, PageHeader, Field, Input, Select, Table, Td, Th, Badge, EmptyState, LinkButton, Notice, Button } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { IntegrationBadge } from "@/components/status";
import { requireUser } from "@/modules/auth/session";
import { query } from "@/lib/db";
import { formatBRL } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { getAdapter } from "@/modules/suppliers/adapters/registry";
import { FIELD_LABELS, type Field as MapField } from "@/modules/catalog/mapping";
import { fetchCatalogAction, importSelectedAction, syncStockAction, uploadCatalogAction } from "./actions";

export const metadata: Metadata = { title: "Importar produtos" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ fornecedor?: string; q?: string }> }) {
  await requireUser("import.run");
  const sp = await searchParams;
  const suppliers = await query<{ id: string; name: string; integration_type: "manual" | "file" | "rest" | "simulated"; integration_status: string }>(
    "select id, name, integration_type, integration_status from suppliers where active order by name",
  );
  if (!suppliers.length) {
    return (
      <>
        <PageHeader title="Importar produtos" />
        <EmptyState title="Nenhum fornecedor cadastrado" description="Cadastre o fornecedor e escolha o método de integração (API, arquivo ou manual)." action={<LinkButton href="/fornecedores/novo">Cadastrar fornecedor</LinkButton>} />
      </>
    );
  }
  const supplier = suppliers.find((s) => s.id === sp.fornecedor) ?? suppliers[0];
  const adapter = getAdapter(supplier.integration_type);
  const search = sp.q ? `%${sp.q}%` : null;
  const [items, jobs] = await Promise.all([
    query<{ supplier_sku: string; title: string; cost_cents: string | null; stock: number | null; data: { images: string[]; variants: unknown[]; brand?: string }; imported_product_id: string | null; fetched_at: string; source: string }>(
      `select supplier_sku, title, cost_cents, stock, data, imported_product_id, fetched_at, source from supplier_catalog_items
       where supplier_id = $1 and ($2::text is null or title ilike $2 or supplier_sku ilike $2) order by imported_product_id nulls first, fetched_at desc limit 300`,
      [supplier.id, search],
    ),
    query<{ id: string; source: string; file_name: string | null; status: string; total_rows: number; ok_rows: number; error_rows: number; errors: { row: number; sku?: string; message: string }[]; created_at: string }>(
      "select * from import_jobs where supplier_id = $1 order by created_at desc limit 5",
      [supplier.id],
    ),
  ]);
  const pending = items.filter((i) => !i.imported_product_id).length;

  return (
    <>
      <PageHeader title="Importar produtos" description="Traga o catálogo do fornecedor com nome, descrição, fotos, custo, SKU, EAN, marca, características, peso, dimensões, variações e estoque." />

      <div className="mb-6 flex flex-wrap gap-2">
        {suppliers.map((s) => (
          <Link key={s.id} href={`/importar?fornecedor=${s.id}`} className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${s.id === supplier.id ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}>{s.name}</Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Integração do fornecedor" description={adapter.label}>
          <div className="mb-3"><IntegrationBadge status={supplier.integration_status} /></div>
          <p className="text-sm text-slate-600">{adapter.description}</p>
          {adapter.fetchCatalog ? (
            <div className="mt-4 space-y-2">
              <ActionForm action={fetchCatalogAction}>
                <input type="hidden" name="supplierId" value={supplier.id} />
                <SubmitButton>Buscar catálogo pela API</SubmitButton>
              </ActionForm>
              {adapter.fetchStock && (
                <ActionForm action={syncStockAction}>
                  <input type="hidden" name="supplierId" value={supplier.id} />
                  <SubmitButton variant="secondary">Atualizar estoque dos produtos importados</SubmitButton>
                </ActionForm>
              )}
            </div>
          ) : (
            <div className="mt-4"><Notice tone="info" title="Sem integração por API">Este fornecedor não possui API configurada. Use a importação por arquivo ao lado ou o <Link className="underline" href="/produtos/novo">cadastro manual</Link>.</Notice></div>
          )}
          <p className="mt-4 text-xs text-slate-500"><Link className="underline" href={`/fornecedores/${supplier.id}`}>Alterar método de integração</Link></p>
        </Card>

        <Card title="Importar arquivo" description="CSV, XML (inclusive feed Google Merchant), XLSX ou JSON — até 15 MB" className="lg:col-span-2">
          <ActionForm action={uploadCatalogAction} className="space-y-4">
            <input type="hidden" name="supplierId" value={supplier.id} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Arquivo" className="sm:col-span-2"><Input type="file" name="file" accept=".csv,.txt,.xml,.xlsx,.json" required /></Field>
              <Field label="Unidade do peso"><Select name="weightUnit" defaultValue="kg"><option value="kg">Quilogramas (kg)</option><option value="g">Gramas (g)</option></Select></Field>
            </div>
            <details className="rounded-lg border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">Mapeamento de colunas (opcional)</summary>
              <p className="mt-2 text-xs text-slate-500">Colunas comuns (sku, nome, preco_custo, estoque, ean, imagens, cor, tamanho, sku_pai…) são reconhecidas automaticamente. Preencha apenas se o arquivo usar nomes diferentes. Colunas <code>attr_Nome</code> viram características técnicas.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {(Object.keys(FIELD_LABELS) as MapField[]).map((f) => (
                  <Field key={f} label={FIELD_LABELS[f]}><Input name={`map_${f}`} placeholder="nome da coluna" /></Field>
                ))}
              </div>
            </details>
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton>Ler arquivo</SubmitButton>
              <a href="/modelo-importacao.csv" className="text-sm text-brand-700 underline" download>Baixar planilha modelo</a>
            </div>
          </ActionForm>
        </Card>
      </div>

      <Card className="mt-6" padded={false} title={`Catálogo recebido de ${supplier.name}`} description={`${items.length} itens · ${pending} aguardando importação. Selecione os produtos que devem aparecer em Produtos.`}
        actions={<form className="flex gap-2"><input type="hidden" name="fornecedor" value={supplier.id} /><Input name="q" placeholder="Buscar" defaultValue={sp.q} className="py-1.5" /><Button size="sm" variant="secondary">Buscar</Button></form>}>
        {items.length ? (
          <ActionForm action={importSelectedAction}>
            <input type="hidden" name="supplierId" value={supplier.id} />
            <Table>
              <thead><tr><Th className="w-8" /><Th>Produto</Th><Th>SKU fornecedor</Th><Th className="text-right">Custo</Th><Th className="text-right">Estoque</Th><Th>Situação</Th></tr></thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.supplier_sku} className="hover:bg-slate-50">
                    <Td><input type="checkbox" name="sku" value={i.supplier_sku} defaultChecked={!i.imported_product_id} className="h-4 w-4 rounded border-slate-300 accent-emerald-600" aria-label={`Selecionar ${i.title}`} /></Td>
                    <Td>
                      <div className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {i.data.images?.[0] ? <img src={i.data.images[0]} alt="" className="h-9 w-9 rounded object-cover ring-1 ring-slate-200" /> : <span className="h-9 w-9 rounded bg-slate-100" />}
                        <div className="min-w-0">
                          <p className="max-w-[320px] truncate font-medium text-slate-900">{i.title}</p>
                          <p className="text-xs text-slate-500">{i.data.brand ?? "Sem marca"} · {i.data.images?.length ?? 0} foto(s){i.data.variants?.length ? ` · ${i.data.variants.length} variações` : ""}</p>
                        </div>
                      </div>
                    </Td>
                    <Td className="font-mono text-xs">{i.supplier_sku}</Td>
                    <Td className="num text-right">{formatBRL(i.cost_cents)}</Td>
                    <Td className="num text-right">{i.stock ?? "—"}</Td>
                    <Td>{i.imported_product_id ? <Link href={`/produtos/${i.imported_product_id}`}><Badge tone="brand">Importado</Badge></Link> : <Badge tone="warning">Novo</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="flex flex-wrap gap-2 border-t border-slate-100 p-4">
              <SubmitButton name="mode" value="selected">Importar selecionados</SubmitButton>
              <SubmitButton name="mode" value="all" variant="secondary">Importar / atualizar todos</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <div className="p-5"><EmptyState title="Nenhum item recebido ainda" description="Envie um arquivo ou busque o catálogo pela API do fornecedor." /></div>
        )}
      </Card>

      {jobs.length > 0 && (
        <Card className="mt-6" title="Últimas importações" padded={false}>
          <ul className="divide-y divide-slate-100">
            {jobs.map((j) => (
              <li key={j.id} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-800">{j.file_name ?? (j.source === "api" ? "Integração por API" : j.source === "simulated" ? "Fornecedor simulado" : j.source)}</span>
                  <span className="text-xs text-slate-500">{formatDateTime(j.created_at)}</span>
                </div>
                <p className="text-xs text-slate-500">{j.status === "failed" ? <Badge tone="danger">Falhou</Badge> : <Badge tone="brand">Concluída</Badge>} {j.ok_rows} válidos · {j.error_rows} com erro</p>
                {j.errors.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-rose-700">Ver erros</summary>
                    <ul className="mt-1 max-h-40 overflow-auto text-xs text-slate-600">{j.errors.slice(0, 50).map((e, k) => <li key={k}>Linha {e.row}{e.sku ? ` (${e.sku})` : ""}: {e.message}</li>)}</ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
