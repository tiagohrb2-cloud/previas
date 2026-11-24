import { Card, Notice, DescList, Badge, buttonClass, Field, Input, Select, Table, Td, Th } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { requireUser } from "@/modules/auth/session";
import { can } from "@/modules/auth/permissions";
import { env, isMercadoLivreConfigured } from "@/lib/env";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { redirectUri } from "@/modules/marketplace/mercadolivre/oauth";
import { disconnectMlAction, officialFeeAction } from "../actions";

export default async function MercadoLivreSettings({ searchParams }: { searchParams: Promise<{ conectado?: string; erro?: string }> }) {
  const user = await requireUser("settings.view");
  const sp = await searchParams;
  const e = env();
  const configured = isMercadoLivreConfigured();
  const accounts = await query<{ id: string; ml_user_id: string; nickname: string | null; status: string; token_expires_at: string; last_error: string | null; created_at: string }>(
    "select id, ml_user_id, nickname, status, token_expires_at, last_error, created_at from ml_accounts order by created_at desc",
  );
  const webhook = new URL("/api/webhooks/mercadolivre", e.APP_URL);
  if (e.ML_WEBHOOK_KEY) webhook.searchParams.set("key", "SEU_ML_WEBHOOK_KEY");
  const canManage = can(user.role, "integrations.manage");
  return (
    <div className="space-y-6">
      {sp.conectado && <Notice tone="success">Conta do Mercado Livre conectada com sucesso.</Notice>}
      {sp.erro && <Notice tone="danger" title="Não foi possível conectar">{sp.erro}</Notice>}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Aplicativo no Mercado Livre" description="Credenciais do aplicativo criado no portal de desenvolvedores (variáveis de ambiente).">
          <DescList items={[
            ["Client ID (ML_CLIENT_ID)", e.ML_CLIENT_ID ? <Badge tone="brand">configurado</Badge> : <Badge tone="danger">ausente</Badge>],
            ["Client Secret (ML_CLIENT_SECRET)", e.ML_CLIENT_SECRET ? <Badge tone="brand">configurado</Badge> : <Badge tone="danger">ausente</Badge>],
            ["Chave do webhook (ML_WEBHOOK_KEY)", e.ML_WEBHOOK_KEY ? <Badge tone="brand">configurada</Badge> : <Badge tone="warning">ausente</Badge>],
            ["Site", e.ML_SITE_ID],
          ]} />
          <div className="mt-5 space-y-3 text-sm">
            <p className="font-medium text-slate-800">Cadastre no aplicativo do Mercado Livre:</p>
            <div><p className="text-xs text-slate-500">URI de redirecionamento</p><code className="block break-all rounded bg-slate-100 px-2 py-1 text-xs">{redirectUri()}</code></div>
            <div><p className="text-xs text-slate-500">URL de notificações (callbacks)</p><code className="block break-all rounded bg-slate-100 px-2 py-1 text-xs">{webhook.toString()}</code></div>
            <p className="text-xs text-slate-500">Tópicos recomendados: orders_v2, shipments, items, claims (pós-venda). A URL precisa ser pública e com HTTPS. Veja docs/MERCADO_LIVRE.md.</p>
          </div>
        </Card>
        <Card title="Conta conectada" description="Autorização OAuth 2.0 (com PKCE). Tokens ficam criptografados no banco.">
          {!configured && <Notice tone="warning">Configure ML_CLIENT_ID e ML_CLIENT_SECRET no ambiente e reinicie a aplicação para habilitar a conexão.</Notice>}
          {accounts.length ? (
            <div className="space-y-3">
              {accounts.map((a) => (
                <div key={a.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div><p className="font-medium text-slate-900">{a.nickname ?? `Usuário ${a.ml_user_id}`}</p><p className="text-xs text-slate-500">ID {a.ml_user_id} · conectada em {formatDateTime(a.created_at)}</p></div>
                    <Badge tone={a.status === "active" ? "brand" : "danger"}>{a.status === "active" ? "Ativa" : a.status === "revoked" ? "Revogada" : a.status}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Token válido até {formatDateTime(a.token_expires_at)} (renovado automaticamente)</p>
                  {a.last_error && <p className="mt-1 text-xs text-rose-600">{a.last_error}</p>}
                  {canManage && a.status !== "revoked" && (
                    <ActionForm action={disconnectMlAction} className="mt-2" confirm="Desconectar esta conta? Pedidos e anúncios deixarão de sincronizar.">
                      <input type="hidden" name="accountId" value={a.id} />
                      <SubmitButton size="sm" variant="ghost">Desconectar</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-slate-500">Nenhuma conta conectada.</p>}
          {canManage && configured && (
            <a href="/api/ml/oauth/start" className={`${buttonClass("primary")} mt-4`}>{accounts.some((a) => a.status === "active") ? "Reconectar conta" : "Conectar conta do Mercado Livre"}</a>
          )}
        </Card>
      </div>

      <Card title="Consultar taxa oficial de venda" description="Consulta a API oficial (listing_prices) para um preço, tipo de anúncio e categoria. Requer conta conectada.">
        <ActionForm action={officialFeeAction} className="grid gap-3 sm:grid-cols-4">
          <Field label="Preço de referência (R$)"><Input name="price" inputMode="decimal" required /></Field>
          <Field label="Tipo de anúncio"><Select name="listing_type_id"><option value="gold_special">Clássico (gold_special)</option><option value="gold_pro">Premium (gold_pro)</option></Select></Field>
          <Field label="Categoria"><Input name="category_id" placeholder="MLB1234" required /></Field>
          <div className="flex items-end"><SubmitButton variant="secondary">Consultar</SubmitButton></div>
        </ActionForm>
      </Card>

      <Card title="Recursos da integração" padded={false}>
        <Table>
          <thead><tr><Th>Recurso</Th><Th>Endpoint oficial utilizado</Th><Th>Situação</Th></tr></thead>
          <tbody>
            {[
              ["Autorização OAuth", "auth.mercadolivre.com.br/authorization · POST /oauth/token"],
              ["Notificações de vendas", "Webhook → GET /orders/{id}"],
              ["Consulta de envio", "GET /shipments/{id}"],
              ["Publicação", "POST /items · POST /items/{id}/description"],
              ["Preço e estoque", "PUT /items/{id}"],
              ["Importação de anúncios", "GET /users/{id}/items/search · GET /items/{id}"],
              ["Categorias e atributos", "GET /sites/MLB/domain_discovery/search · GET /categories/{id}/attributes"],
              ["Taxas de venda", "GET /sites/MLB/listing_prices"],
              ["Reclamações", "GET /post-purchase/v1/claims/{id}"],
              ["Etiqueta", "GET /shipment_labels"],
            ].map(([r, ep]) => (
              <tr key={r}><Td>{r}</Td><Td className="font-mono text-xs">{ep}</Td><Td>{accounts.some((a) => a.status === "active") ? <Badge tone="info">Implementado · validar com conta real</Badge> : <Badge>Implementado · aguardando conta</Badge>}</Td></tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
