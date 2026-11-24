import { notFound } from "next/navigation";
import { Card, PageHeader, Field, Input, Select, Notice, Button, Badge } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { requireUser } from "@/modules/auth/session";
import { publishPreview } from "@/modules/listings/service";
import { activeMarketplaceContext } from "@/modules/marketplace/registry";
import { listFeeProfiles, listPricingRules } from "@/modules/pricing/service";
import { getSettings } from "@/lib/settings";
import { queryOne } from "@/lib/db";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/format";
import type { CategoryAttribute } from "@/modules/marketplace/types";
import { predictCategoryAction, publishAction } from "../../actions";

type SP = { categoria?: string; tipo?: string; regra?: string; preco?: string };

export default async function PublishPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  await requireUser("listings.publish");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sp = await searchParams;
  const [feeProfiles, rules, settings] = await Promise.all([listFeeProfiles(), listPricingRules(), getSettings()]);
  const defaultRule = rules.find((r) => r.is_default);
  const ruleId = sp.regra ?? defaultRule?.id ?? "";
  const rule = rules.find((r) => r.id === ruleId);
  const listingTypes = [...new Set(feeProfiles.map((f) => f.listing_type_id))];
  const listingTypeId = sp.tipo ?? feeProfiles.find((f) => f.id === rule?.fee_profile_id)?.listing_type_id ?? listingTypes[0] ?? "gold_special";
  const manualPrice = sp.preco ? Math.round(Number(sp.preco.replace(/\./g, "").replace(",", ".")) * 100) : null;

  const stored = await queryOne<{ ml_category_id: string | null }>("select ml_category_id from products where id = $1", [id]);
  if (!stored) notFound();
  const categoryId = sp.categoria || stored.ml_category_id || "";
  const preview = await publishPreview({ productId: id, categoryId, listingTypeId, pricingRuleId: ruleId || null, priceCents: manualPrice && manualPrice > 0 ? manualPrice : null });

  let attributes: CategoryAttribute[] = [];
  let marketplaceError: string | null = null;
  try {
    const { adapter, account } = await activeMarketplaceContext();
    if (categoryId && adapter.getCategoryAttributes) attributes = await adapter.getCategoryAttributes(account, categoryId);
  } catch (e) {
    marketplaceError = (e as Error).message;
  }
  const r = preview.pricing.result;
  const prefill: Record<string, string> = { BRAND: preview.product.brand ?? "", GTIN: preview.product.gtin ?? "" };
  const variationIds = new Set(["COLOR", "SIZE"]);
  const shownAttrs = attributes.filter((a) => a.required || ["BRAND", "MODEL", "GTIN"].includes(a.id)).filter((a) => !(preview.multiVariant && variationIds.has(a.id)));
  const publish = publishAction.bind(null, id);

  return (
    <>
      <PageHeader back={{ href: `/produtos/${id}`, label: "Produto" }} title="Publicar anúncio" description={preview.product.title} />
      {settings.operation_mode === "test" && <div className="mb-4"><Notice tone="warning">Modo teste: o anúncio será criado no marketplace SIMULADO.</Notice></div>}
      {marketplaceError && <div className="mb-4"><Notice tone="danger" title="Marketplace indisponível">{marketplaceError}</Notice></div>}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="1. Categoria, tipo de anúncio e preço" description="Altere e clique em Atualizar prévia para recalcular.">
            <form className="grid gap-4 sm:grid-cols-2">
              <Field label="Categoria do Mercado Livre" hint="Código da categoria (ex.: MLB1055). Use a sugestão abaixo."><Input name="categoria" defaultValue={categoryId} required /></Field>
              <Field label="Tipo de anúncio" hint="Conforme os perfis de taxas cadastrados">
                <Select name="tipo" defaultValue={listingTypeId}>
                  {(listingTypes.length ? listingTypes : ["gold_special", "gold_pro"]).map((t) => <option key={t} value={t}>{t === "gold_special" ? "Clássico (gold_special)" : t === "gold_pro" ? "Premium (gold_pro)" : t}</option>)}
                </Select>
              </Field>
              <Field label="Regra de preço">
                <Select name="regra" defaultValue={ruleId}>
                  {rules.map((ru) => <option key={ru.id} value={ru.id}>{ru.name}{ru.is_default ? " (padrão)" : ""}</option>)}
                  {!rules.length && <option value="">Nenhuma regra cadastrada</option>}
                </Select>
              </Field>
              <Field label="Preço manual (opcional, R$)" hint="Sobrepõe a regra"><Input name="preco" defaultValue={sp.preco ?? ""} inputMode="decimal" /></Field>
              <div className="sm:col-span-2"><Button variant="secondary" type="submit">Atualizar prévia</Button></div>
            </form>
            <ActionForm action={predictCategoryAction} className="mt-4 border-t border-slate-100 pt-4">
              <input type="hidden" name="title" value={preview.product.title} />
              <SubmitButton variant="ghost" size="sm">Sugerir categoria pelo título (API do marketplace)</SubmitButton>
            </ActionForm>
          </Card>

          <Card title="2. Atributos da categoria" description="Atributos obrigatórios exigidos pelo Mercado Livre para esta categoria.">
            {!categoryId ? (
              <p className="text-sm text-slate-500">Informe a categoria e atualize a prévia para carregar os atributos.</p>
            ) : (
              <ActionForm action={publish} className="space-y-4" confirm="Confirmar a publicação deste anúncio?">
                <input type="hidden" name="categoryId" value={categoryId} />
                <input type="hidden" name="listingTypeId" value={listingTypeId} />
                <input type="hidden" name="ruleId" value={ruleId} />
                <input type="hidden" name="manualPrice" value={sp.preco ?? ""} />
                <Field label="Título do anúncio" hint="Máximo de 60 caracteres no Mercado Livre"><Input name="title" defaultValue={preview.product.title.slice(0, 60)} maxLength={60} /></Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  {shownAttrs.map((a) => (
                    <Field key={a.id} label={`${a.name}${a.required ? " *" : ""}`} hint={a.id}>
                      {a.values.length ? (
                        <Select name={`attr_${a.id}`} defaultValue={prefill[a.id] ?? ""}>
                          <option value="">Selecione</option>
                          {a.values.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
                        </Select>
                      ) : (
                        <Input name={`attr_${a.id}`} defaultValue={prefill[a.id] ?? ""} />
                      )}
                    </Field>
                  ))}
                </div>
                {preview.multiVariant && <Notice>As variações (cor e tamanho) serão enviadas com o SKU de cada uma, para o pedido ser vinculado à variação correta.</Notice>}
                <SubmitButton>Publicar anúncio</SubmitButton>
              </ActionForm>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Prévia financeira (por unidade)">
            <p className="text-xs uppercase tracking-wide text-slate-500">Preço de venda</p>
            <p className="num text-3xl font-semibold text-slate-900">{formatBRL(r.priceCents)}</p>
            <dl className="num mt-4 space-y-1.5 text-sm">
              {([
                ["Comissão", r.commissionCents], ["Tarifa fixa", r.fixedFeeCents], ["Frete do vendedor", r.sellerShippingCents],
                ["Outros custos", r.extraCostCents + r.extraPercentCostCents], ["Custo do fornecedor", r.productCostCents],
              ] as [string, number][]).map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-slate-600">{k}</dt><dd>-{formatBRL(v)}</dd></div>)}
              <div className={`flex justify-between border-t border-slate-200 pt-2 font-semibold ${r.netProfitCents > 0 ? "text-brand-700" : "text-rose-700"}`}><dt>Lucro líquido estimado</dt><dd>{formatBRL(r.netProfitCents)}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-slate-500">
              Taxas: {preview.pricing.feeProfile ? <>{preview.pricing.feeProfile.name} ({String(preview.pricing.feeProfile.commission_percent).replace(".", ",")}%) · conferido em {formatDate(preview.pricing.feeProfile.verified_at)}</> : "nenhum perfil"}
            </p>
            {r.warnings.map((w) => <p key={w} className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">{w}</p>)}
          </Card>
          <Card title="Estoque a publicar">
            <p className="num text-2xl font-semibold">{preview.totalStock} <span className="text-sm font-normal text-slate-500">unidades</span></p>
            {preview.multiVariant && (
              <ul className="mt-3 space-y-1 text-sm">
                {preview.variants.map((v) => <li key={v.id} className="flex justify-between"><span>{Object.values(v.attributes).join(" / ")}</span><span className="num">{v.sellable}</span></li>)}
              </ul>
            )}
          </Card>
          <Card title="Verificações">
            {preview.issues.length ? (
              <ul className="space-y-2">{preview.issues.map((i) => <li key={i}><Badge tone="warning">Atenção</Badge> <span className="text-sm text-slate-700">{i}</span></li>)}</ul>
            ) : <p className="text-sm text-brand-700">Tudo certo para publicar.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
