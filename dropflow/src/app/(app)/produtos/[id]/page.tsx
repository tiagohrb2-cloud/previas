import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, PageHeader, Table, Td, Th, Badge, LinkButton, Field, Input, Select, Textarea, DescList, Notice } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { PriceCalculator } from "@/components/price-calculator";
import { ListingStatusBadge } from "@/components/status";
import { requireUser } from "@/modules/auth/session";
import { can } from "@/modules/auth/permissions";
import { query, queryOne } from "@/lib/db";
import { formatBRL } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { sellableStock } from "@/modules/catalog/service";
import { listFeeProfiles, toTiers } from "@/modules/pricing/service";
import { setStockAction, updateProductAction } from "../actions";

export default async function ProductDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("products.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const p = await queryOne<{
    id: string; title: string; description: string; sku: string; supplier_sku: string; brand: string | null; gtin: string | null;
    cost_cents: string; weight_g: number | null; length_cm: string | null; width_cm: string | null; height_cm: string | null;
    attributes: Record<string, string>; status: string; source: string; ml_category_id: string | null; condition: string;
    seller_shipping_cost_cents: string; supplier_id: string; supplier_name: string; last_synced_at: string | null; created_at: string;
  }>(`select p.*, s.name as supplier_name from products p join suppliers s on s.id = p.supplier_id where p.id = $1`, [id]);
  if (!p) notFound();
  const [images, variants, listings, settings, feeProfiles, defaultRule] = await Promise.all([
    query<{ url: string }>("select url from product_images where product_id = $1 order by position", [id]),
    query<{ id: string; sku: string; supplier_sku: string; attributes: Record<string, string>; cost_cents: string | null; is_default: boolean; active: boolean; quantity: number; reserved: number; updated_at: string | null }>(
      `select v.id, v.sku, v.supplier_sku, v.attributes, v.cost_cents, v.is_default, v.active, coalesce(i.quantity,0) as quantity, coalesce(i.reserved,0) as reserved, i.updated_at
       from product_variants v left join inventory i on i.variant_id = v.id where v.product_id = $1 order by v.active desc, v.sku`, [id]),
    query<{ id: string; external_id: string | null; marketplace: string; status: string; price_cents: string | null; permalink: string | null; pricing_snapshot: { netProfitCents?: number } | null }>(
      "select id, external_id, marketplace, status, price_cents, permalink, pricing_snapshot from listings where product_id = $1 order by created_at desc", [id]),
    getSettings(),
    listFeeProfiles(),
    queryOne<{ mode: "margin_fixed" | "margin_percent" | "fixed_price" | "multiplier"; value: string; fee_profile_id: string | null; extra_cost_cents: string; extra_cost_percent: string }>("select * from pricing_rules where is_default"),
  ]);
  const canEdit = can(user.role, "products.edit");
  const totalSellable = variants.filter((v) => v.active).reduce((s, v) => s + sellableStock(v.quantity, v.reserved, settings.stock_safety_margin), 0);
  const update = updateProductAction.bind(null, id);
  const maxCost = Math.max(Number(p.cost_cents), ...variants.filter((v) => v.active).map((v) => Number(v.cost_cents ?? p.cost_cents)));

  return (
    <>
      <PageHeader
        back={{ href: "/produtos", label: "Produtos" }}
        title={p.title}
        description={<>SKU {p.sku} · fornecedor <Link className="underline" href={`/fornecedores/${p.supplier_id}`}>{p.supplier_name}</Link> · origem: {p.source === "api" ? "API" : p.source === "file" ? "arquivo" : p.source === "simulated" ? "simulado" : "manual"}</>}
        actions={can(user.role, "listings.publish") ? <LinkButton href={`/produtos/${id}/publicar`}>Publicar no Mercado Livre</LinkButton> : undefined}
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Dados do produto">
            <ActionForm action={update} className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome" className="sm:col-span-2"><Input name="title" defaultValue={p.title} disabled={!canEdit} required /></Field>
              <Field label="Descrição completa" className="sm:col-span-2"><Textarea name="description" rows={6} defaultValue={p.description} disabled={!canEdit} /></Field>
              <Field label="Marca"><Input name="brand" defaultValue={p.brand ?? ""} disabled={!canEdit} /></Field>
              <Field label="Código de barras (EAN/GTIN)"><Input name="gtin" defaultValue={p.gtin ?? ""} inputMode="numeric" disabled={!canEdit} /></Field>
              <Field label="Preço de custo (R$)" hint="Atualizado pelo fornecedor a cada importação"><Input name="cost" defaultValue={(Number(p.cost_cents) / 100).toFixed(2).replace(".", ",")} inputMode="decimal" disabled={!canEdit} /></Field>
              <Field label="Frete pago pelo vendedor (R$)" hint="Parte do frete grátis que fica por sua conta (consulte no Mercado Livre)"><Input name="seller_shipping" defaultValue={(Number(p.seller_shipping_cost_cents) / 100).toFixed(2).replace(".", ",")} inputMode="decimal" disabled={!canEdit} /></Field>
              <Field label="Categoria do Mercado Livre" hint="Ex.: MLB1234 — definida na publicação"><Input name="ml_category_id" defaultValue={p.ml_category_id ?? ""} disabled={!canEdit} /></Field>
              <Field label="Condição"><Select name="condition" defaultValue={p.condition} disabled={!canEdit}><option value="new">Novo</option><option value="used">Usado</option></Select></Field>
              <Field label="Status"><Select name="status" defaultValue={p.status} disabled={!canEdit}><option value="draft">Rascunho</option><option value="active">Ativo</option><option value="inactive">Inativo</option></Select></Field>
              {canEdit && <div className="flex items-end"><SubmitButton>Salvar alterações</SubmitButton></div>}
            </ActionForm>
          </Card>

          <Card title="Variações e estoque" description={`Estoque vendável = disponível − reservado − margem de segurança (${settings.stock_safety_margin}).`} padded={false}>
            <Table>
              <thead><tr><Th>SKU</Th><Th>Variação</Th><Th className="text-right">Custo</Th><Th className="text-right">Disponível</Th><Th className="text-right">Reservado</Th><Th className="text-right">Vendável</Th>{canEdit && <Th>Ajustar</Th>}</tr></thead>
              <tbody>
                {variants.map((v) => (
                  <tr key={v.id} className={v.active ? "" : "opacity-50"}>
                    <Td><span className="font-mono text-xs">{v.sku}</span><span className="block text-[11px] text-slate-400">forn.: {v.supplier_sku}</span></Td>
                    <Td>{v.is_default ? <span className="text-slate-400">Única</span> : Object.entries(v.attributes).map(([k, val]) => <Badge key={k}>{k}: {val}</Badge>)}{!v.active && <Badge tone="warning">Inativa</Badge>}</Td>
                    <Td className="num text-right">{formatBRL(v.cost_cents ?? p.cost_cents)}</Td>
                    <Td className="num text-right">{v.quantity}</Td>
                    <Td className="num text-right">{v.reserved}</Td>
                    <Td className="num text-right font-medium">{sellableStock(v.quantity, v.reserved, settings.stock_safety_margin)}</Td>
                    {canEdit && (
                      <Td>
                        <ActionForm action={setStockAction} className="flex items-center gap-1">
                          <input type="hidden" name="variantId" value={v.id} />
                          <Input name="quantity" type="number" min={0} defaultValue={v.quantity} className="w-20 py-1" />
                          <SubmitButton size="sm" variant="secondary">OK</SubmitButton>
                        </ActionForm>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card title="Simulador de preço e lucro" description="Mesma regra de cálculo usada na publicação.">
            <PriceCalculator
              feeProfiles={feeProfiles.map((f) => ({ id: f.id, name: f.name, commissionPercent: Number(f.commission_percent), tiers: toTiers(f.fixed_fee_tiers) }))}
              initial={{
                costCents: maxCost,
                shippingCents: Number(p.seller_shipping_cost_cents),
                mode: defaultRule?.mode,
                value: defaultRule ? Number(defaultRule.value) : undefined,
                extraCents: defaultRule ? Number(defaultRule.extra_cost_cents) : 0,
                extraPercent: defaultRule ? Number(defaultRule.extra_cost_percent) : 0,
                feeProfileId: defaultRule?.fee_profile_id,
              }}
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Fotos">
            {images.length ? (
              <div className="grid grid-cols-3 gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {images.map((i) => <a key={i.url} href={i.url} target="_blank" rel="noreferrer"><img src={i.url} alt="" className="aspect-square w-full rounded-lg object-cover ring-1 ring-slate-200" /></a>)}
              </div>
            ) : <Notice tone="warning">Sem fotos. O Mercado Livre exige ao menos uma imagem.</Notice>}
          </Card>
          <Card title="Resumo">
            <DescList items={[
              ["Estoque vendável", totalSellable],
              ["Peso", p.weight_g ? `${(p.weight_g / 1000).toLocaleString("pt-BR")} kg` : "—"],
              ["Dimensões (C × L × A)", p.length_cm ? `${Number(p.length_cm)} × ${Number(p.width_cm)} × ${Number(p.height_cm)} cm` : "—"],
              ["Última sincronização", formatDateTime(p.last_synced_at)],
            ]} />
          </Card>
          <Card title="Características técnicas">
            {Object.keys(p.attributes).length ? <DescList items={Object.entries(p.attributes).map(([k, v]) => [k, v])} /> : <p className="text-sm text-slate-500">Nenhuma característica importada.</p>}
          </Card>
          <Card title="Anúncios" padded={false}>
            {listings.length ? (
              <ul className="divide-y divide-slate-100">
                {listings.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                    <div>
                      <p className="font-medium text-slate-900">{l.external_id ?? "—"} {l.marketplace === "simulated" && <Badge>simulado</Badge>}</p>
                      <p className="text-xs text-slate-500">{formatBRL(l.price_cents)} · lucro est. {formatBRL(l.pricing_snapshot?.netProfitCents ?? null)}</p>
                    </div>
                    <ListingStatusBadge status={l.status} />
                  </li>
                ))}
              </ul>
            ) : <p className="px-5 py-4 text-sm text-slate-500">Ainda não publicado.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
