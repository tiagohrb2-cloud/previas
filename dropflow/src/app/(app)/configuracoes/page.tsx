import { Card, Field, Input, Notice, Select, Badge } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { requireUser } from "@/modules/auth/session";
import { can } from "@/modules/auth/permissions";
import { getSettings } from "@/lib/settings";
import { automationAction, setModeAction } from "./actions";
import { productionReadiness } from "@/modules/settings/readiness";

function Toggle({ name, label, description, defaultChecked, disabled }: { name: string; label: string; description: string; defaultChecked: boolean; disabled?: boolean }) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-4">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} disabled={disabled} className="mt-0.5 h-4 w-4 accent-emerald-600" />
      <span>
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        <span className="block text-xs text-slate-500">{description}</span>
      </span>
    </label>
  );
}

export default async function GeneralSettings() {
  const user = await requireUser("settings.view");
  const s = await getSettings();
  const readiness = await productionReadiness();
  const canEdit = can(user.role, "settings.edit");
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title="Modo de operação" description="Teste usa marketplace e fornecedor simulados. Produção usa contas e integrações reais.">
        <div className="mb-4 flex items-center gap-2">Atual: {s.operation_mode === "test" ? <Badge tone="warning">MODO TESTE</Badge> : <Badge tone="brand">PRODUÇÃO</Badge>}</div>
        {readiness.length > 0 && (
          <Notice tone="warning" title="Pendências para o modo produção">
            <ul className="list-disc pl-4">{readiness.map((r) => <li key={r}>{r}</li>)}</ul>
          </Notice>
        )}
        {canEdit && (
          <ActionForm action={setModeAction} className="mt-4 flex flex-wrap gap-2" confirm="Trocar o modo de operação? Em produção, pedidos e anúncios são reais.">
            <input type="hidden" name="mode" value={s.operation_mode === "test" ? "production" : "test"} />
            <SubmitButton variant={s.operation_mode === "test" ? "primary" : "secondary"}>{s.operation_mode === "test" ? "Ativar modo produção" : "Voltar ao modo teste"}</SubmitButton>
          </ActionForm>
        )}
      </Card>

      <Card title="Automação" description="Nada é publicado ou encaminhado automaticamente sem a sua autorização aqui.">
        <ActionForm action={automationAction} className="space-y-3">
          <Toggle name="auto_forward" label="Encaminhar pedidos automaticamente aos fornecedores" defaultChecked={s.auto_forward_orders_enabled} disabled={!canEdit}
            description="Vale apenas para fornecedores com API de pedidos verificada e fluxo logístico comprovado. Os demais continuam pedindo aprovação." />
          <Toggle name="auto_publish" label="Publicar anúncios automaticamente" defaultChecked={s.auto_publish_enabled} disabled={!canEdit}
            description="Publica produtos marcados como Ativos, com categoria definida e estoque, usando a regra de preço padrão." />
          <Toggle name="auto_sync" label="Sincronizar estoque e preço dos anúncios automaticamente" defaultChecked={s.auto_stock_sync_enabled} disabled={!canEdit}
            description="Quando o estoque ou o custo do fornecedor mudar, atualiza o anúncio no marketplace." />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Margem de segurança de estoque" hint="Unidades que não são anunciadas"><Input name="safety_margin" type="number" min={0} defaultValue={s.stock_safety_margin} disabled={!canEdit} /></Field>
            <Field label="Arredondamento de preço"><Select name="rounding" defaultValue={s.price_rounding} disabled={!canEdit}><option value="none">Sem arredondamento</option><option value="ninety">Terminar em ,90</option></Select></Field>
            <Field label="Retenção de dados do comprador (dias)" hint="LGPD: após entrega/cancelamento"><Input name="retention" type="number" min={30} max={1825} defaultValue={s.buyer_data_retention_days} disabled={!canEdit} /></Field>
          </div>
          {canEdit && <SubmitButton>Salvar</SubmitButton>}
        </ActionForm>
      </Card>
    </div>
  );
}
