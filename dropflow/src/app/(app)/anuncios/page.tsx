import Link from "next/link";
import type { Metadata } from "next";
import { Card, PageHeader, Table, Td, Th, EmptyState, Notice, Select, Badge, LinkButton } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ListingStatusBadge } from "@/components/status";
import { requireUser } from "@/modules/auth/session";
import { can } from "@/modules/auth/permissions";
import { activeMarketplace, getSettings } from "@/lib/settings";
import { query } from "@/lib/db";
import { formatBRL } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { importListingsAction, linkListingAction, statusListingAction, syncListingAction } from "./actions";

export const metadata: Metadata = { title: "Anúncios" };

export default async function ListingsPage({ searchParams }: { searchParams: Promise<{ status?: string; publicado?: string }> }) {
  const user = await requireUser("listings.view");
  const sp = await searchParams;
  const marketplace = await activeMarketplace();
  const settings = await getSettings();
  const params: unknown[] = [marketplace];
  let filter = "";
  if (sp.status) { params.push(sp.status); filter = ` and l.status = $2`; }
  const [rows, products] = await Promise.all([
    query<{ id: string; external_id: string | null; title: string; status: string; price_cents: string | null; available_quantity: number | null; listing_type_id: string | null; permalink: string | null; last_synced_at: string | null; sync_error: string | null; product_id: string | null; product_title: string | null; supplier_name: string | null; profit: number | null }>(
      `select l.*, p.title as product_title, s.name as supplier_name, (l.pricing_snapshot->>'netProfitCents')::int as profit
       from listings l left join products p on p.id = l.product_id left join suppliers s on s.id = p.supplier_id
       where l.marketplace = $1 ${filter} order by l.updated_at desc limit 300`, params),
    query<{ id: string; title: string; sku: string }>("select id, title, sku from products order by title limit 1000"),
  ]);
  const canPublish = can(user.role, "listings.publish");
  return (
    <>
      <PageHeader
        title="Anúncios"
        description={`Anúncios ${marketplace === "simulated" ? "do marketplace simulado (modo teste)" : "da sua conta do Mercado Livre"} vinculados aos produtos dos fornecedores.`}
        actions={canPublish ? <ActionForm action={importListingsAction}><SubmitButton variant="secondary">Importar anúncios da conta</SubmitButton></ActionForm> : undefined}
      />
      {sp.publicado && <div className="mb-4"><Notice tone="success">Anúncio publicado com sucesso.</Notice></div>}
      <div className="mb-4"><Notice>Publicação automática: <strong>{settings.auto_publish_enabled ? "ativada" : "desativada"}</strong> · Sincronização automática de estoque e preço: <strong>{settings.auto_stock_sync_enabled ? "ativada" : "desativada"}</strong>. <Link className="underline" href="/configuracoes">Alterar</Link></Notice></div>
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {[["", "Todos"], ["active", "Ativos"], ["paused", "Pausados"], ["unlinked", "Não vinculados"], ["error", "Com erro"]].map(([v, l]) => (
          <Link key={v} href={v ? `/anuncios?status=${v}` : "/anuncios"} className={`rounded-full px-3 py-1 ring-1 ring-inset ${(sp.status ?? "") === v ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-slate-700 ring-slate-300"}`}>{l}</Link>
        ))}
      </div>
      <Card padded={false}>
        {rows.length ? (
          <Table>
            <thead><tr><Th>Anúncio</Th><Th>Produto / fornecedor</Th><Th className="text-right">Preço</Th><Th className="text-right">Estoque</Th><Th className="text-right">Lucro est.</Th><Th>Status</Th><Th>Ações</Th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="align-top">
                  <Td>
                    <p className="max-w-[260px] truncate font-medium text-slate-900">{l.title}</p>
                    <p className="font-mono text-[11px] text-slate-400">{l.external_id ?? "—"} · {l.listing_type_id ?? ""}</p>
                    {l.permalink && <a href={l.permalink} target="_blank" rel="noreferrer" className="text-xs text-brand-700 underline">Ver no Mercado Livre</a>}
                    {l.sync_error && <p className="mt-1 max-w-[260px] text-[11px] text-rose-600">{l.sync_error}</p>}
                  </Td>
                  <Td>
                    {l.product_id ? <Link href={`/produtos/${l.product_id}`} className="hover:text-brand-700">{l.product_title}<span className="block text-xs text-slate-500">{l.supplier_name}</span></Link> : canPublish ? (
                      <ActionForm action={linkListingAction} className="flex gap-1">
                        <input type="hidden" name="listingId" value={l.id} />
                        <Select name="productId" className="max-w-[200px] py-1 text-xs" defaultValue=""><option value="">Vincular a…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.title.slice(0, 50)} ({p.sku})</option>)}</Select>
                        <SubmitButton size="sm" variant="secondary">OK</SubmitButton>
                      </ActionForm>
                    ) : <Badge tone="warning">Sem vínculo</Badge>}
                  </Td>
                  <Td className="num text-right">{formatBRL(l.price_cents)}</Td>
                  <Td className="num text-right">{l.available_quantity ?? "—"}</Td>
                  <Td className="num text-right">{l.profit !== null ? formatBRL(l.profit) : "—"}</Td>
                  <Td><ListingStatusBadge status={l.status} /><p className="mt-1 text-[11px] text-slate-400">{formatDateTime(l.last_synced_at)}</p></Td>
                  <Td>
                    {canPublish && l.external_id && l.product_id && (
                      <div className="flex flex-col gap-1">
                        <ActionForm action={syncListingAction}><input type="hidden" name="listingId" value={l.id} /><SubmitButton size="sm" variant="secondary">Sincronizar</SubmitButton></ActionForm>
                        {(l.status === "active" || l.status === "paused") && (
                          <ActionForm action={statusListingAction} confirm={l.status === "active" ? "Pausar este anúncio no marketplace?" : "Reativar este anúncio?"}>
                            <input type="hidden" name="listingId" value={l.id} />
                            <input type="hidden" name="status" value={l.status === "active" ? "paused" : "active"} />
                            <SubmitButton size="sm" variant="ghost">{l.status === "active" ? "Pausar" : "Reativar"}</SubmitButton>
                          </ActionForm>
                        )}
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <div className="p-5"><EmptyState title="Nenhum anúncio" description="Publique produtos a partir da página do produto ou importe os anúncios existentes da sua conta." action={<LinkButton href="/produtos">Ver produtos</LinkButton>} /></div>}
      </Card>
    </>
  );
}
