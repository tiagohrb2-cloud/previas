import Link from "next/link";
import type { Metadata } from "next";
import { Card, PageHeader, Table, Td, Th, Badge, EmptyState, LinkButton, Pagination, Input, Select, Button } from "@/components/ui";
import { ListingStatusBadge } from "@/components/status";
import { requireUser } from "@/modules/auth/session";
import { query, queryOne } from "@/lib/db";
import { formatBRL } from "@/lib/money";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Produtos" };
const PAGE = 25;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser("products.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.p ?? 1));
  const settings = await getSettings();
  const where: string[] = ["true"];
  const params: unknown[] = [settings.stock_safety_margin];
  if (sp.q) { params.push(`%${sp.q}%`); where.push(`(p.title ilike $${params.length} or p.sku ilike $${params.length} or p.supplier_sku ilike $${params.length} )`); }
  if (sp.status && ["draft", "active", "inactive"].includes(sp.status)) { params.push(sp.status); where.push(`p.status = $${params.length}`); }
  if (sp.fornecedor) { params.push(sp.fornecedor); where.push(`p.supplier_id = $${params.length}::uuid`); }
  const having = sp.estoque === "zerado" ? "where s.sellable <= 0" : sp.estoque === "disponivel" ? "where s.sellable > 0" : "";
  const base = `
    with s as (
      select p.id, p.title, p.sku, p.supplier_sku, p.cost_cents, p.status, p.brand, sup.name as supplier_name,
        (select url from product_images i where i.product_id = p.id order by position limit 1) as image,
        (select count(*) from product_variants v where v.product_id = p.id and v.active and not v.is_default) as variants,
        (select coalesce(sum(greatest(0, coalesce(i.quantity,0) - coalesce(i.reserved,0) - $1)),0) from product_variants v left join inventory i on i.variant_id = v.id where v.product_id = p.id and v.active) as sellable,
        (select l.status from listings l where l.product_id = p.id order by l.created_at desc limit 1) as listing_status,
        p.updated_at
      from products p join suppliers sup on sup.id = p.supplier_id
      where ${where.join(" and ")}
    )`;
  const [rows, total, suppliers] = await Promise.all([
    query<{ id: string; title: string; sku: string; supplier_sku: string; cost_cents: string; status: string; brand: string | null; supplier_name: string; image: string | null; variants: string; sellable: string; listing_status: string | null }>(
      `${base} select * from s ${having} order by updated_at desc limit ${PAGE} offset ${(page - 1) * PAGE}`, params),
    queryOne<{ n: string }>(`${base} select count(*) as n from s ${having}`, params),
    query<{ id: string; name: string }>("select id, name from suppliers order by name"),
  ]);
  const qs = (p: number) => `/produtos?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)) as Record<string, string>, p: String(p) })}`;
  const statusLabel: Record<string, [string, "neutral" | "brand" | "warning"]> = { draft: ["Rascunho", "neutral"], active: ["Ativo", "brand"], inactive: ["Inativo", "warning"] };

  return (
    <>
      <PageHeader
        title="Produtos"
        description="Catálogo importado dos fornecedores. Preço de venda e lucro são calculados na publicação."
        actions={<><LinkButton href="/importar" variant="secondary">Importar produtos</LinkButton><LinkButton href="/produtos/novo">Cadastrar manualmente</LinkButton></>}
      />
      <Card padded={false}>
        <form className="grid gap-2 border-b border-slate-100 p-4 sm:grid-cols-5">
          <Input name="q" placeholder="Buscar por nome ou SKU" defaultValue={sp.q} className="sm:col-span-2" />
          <Select name="fornecedor" defaultValue={sp.fornecedor ?? ""}><option value="">Todos os fornecedores</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Select name="status" defaultValue={sp.status ?? ""}><option value="">Todos os status</option><option value="draft">Rascunho</option><option value="active">Ativo</option><option value="inactive">Inativo</option></Select>
          <div className="flex gap-2">
            <Select name="estoque" defaultValue={sp.estoque ?? ""}><option value="">Estoque: todos</option><option value="disponivel">Com estoque</option><option value="zerado">Sem estoque</option></Select>
            <Button variant="dark" type="submit">Filtrar</Button>
          </div>
        </form>
        {rows.length ? (
          <>
            <Table>
              <thead><tr><Th>Produto</Th><Th>Fornecedor</Th><Th className="text-right">Custo</Th><Th className="text-right">Estoque</Th><Th>Status</Th><Th>Anúncio</Th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <Td>
                      <Link href={`/produtos/${r.id}`} className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {r.image ? <img src={r.image} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover ring-1 ring-slate-200" /> : <span className="h-10 w-10 shrink-0 rounded-md bg-slate-100" />}
                        <span className="min-w-0">
                          <span className="block max-w-[320px] truncate font-medium text-slate-900">{r.title}</span>
                          <span className="block text-xs text-slate-500">{r.sku}{Number(r.variants) ? ` · ${r.variants} variações` : ""}</span>
                        </span>
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap">{r.supplier_name}</Td>
                    <Td className="num text-right">{formatBRL(r.cost_cents)}</Td>
                    <Td className="num text-right">{Number(r.sellable) > 0 ? r.sellable : <Badge tone="danger">Sem estoque</Badge>}</Td>
                    <Td><Badge tone={statusLabel[r.status]?.[1]}>{statusLabel[r.status]?.[0]}</Badge></Td>
                    <Td>{r.listing_status ? <ListingStatusBadge status={r.listing_status} /> : <span className="text-xs text-slate-400">Não publicado</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} total={Number(total?.n ?? 0)} pageSize={PAGE} baseHref={qs} />
          </>
        ) : (
          <div className="p-5"><EmptyState title="Nenhum produto encontrado" description="Importe o catálogo de um fornecedor ou cadastre um produto manualmente." action={<LinkButton href="/importar">Importar produtos</LinkButton>} /></div>
        )}
      </Card>
    </>
  );
}
