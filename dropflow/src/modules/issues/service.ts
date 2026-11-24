import { query, queryOne, tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { raiseAlert, resolveAlerts } from "@/lib/alerts";
import { marketplaceContextFor } from "@/modules/marketplace/registry";
import type { MarketplaceId } from "@/modules/marketplace/types";
import { recomputeOrderStatus } from "@/modules/orders/processor";

export const CLAIM_TYPE_LABELS: Record<string, string> = {
  claim: "Reclamação", cancellation: "Cancelamento", return: "Devolução", mediation: "Mediação", other: "Outro",
};
export const CLAIM_STATUS_LABELS: Record<string, string> = {
  open: "Aberta", in_progress: "Em atendimento", waiting_marketplace: "Aguardando Mercado Livre", resolved: "Resolvida", closed: "Encerrada",
};
export const RETURN_STATUS_LABELS: Record<string, string> = {
  requested: "Solicitada", in_transit_to_seller: "Em trânsito", received: "Recebida", sent_to_supplier: "Enviada ao fornecedor",
  received_by_supplier: "Recebida pelo fornecedor", closed: "Encerrada",
};

/**
 * Registra/atualiza uma reclamação a partir dos dados oficiais do marketplace.
 * O DropFlow NÃO executa reembolsos, cancelamentos ou respostas automáticas:
 * essas ações são feitas pelo administrador no próprio Mercado Livre.
 */
export async function syncClaim(params: { marketplace: MarketplaceId; accountId: string | null; claimId: string }) {
  const { adapter, account } = await marketplaceContextFor(params.marketplace, params.accountId);
  const c = await adapter.getClaim(account, params.claimId);
  await tx(async (db) => {
    const order = c.externalOrderId
      ? await queryOne<{ id: string; code: string }>("select id, code from orders where marketplace = $1 and (external_order_id = $2 or external_pack_id = $2)", [params.marketplace, c.externalOrderId], db)
      : null;
    const supplier = order ? await queryOne<{ supplier_id: string }>("select supplier_id from order_items where order_id = $1 and supplier_id is not null limit 1", [order.id], db) : null;
    const existing = await queryOne<{ id: string; external_status: string | null }>(
      "select id, external_status from claims where marketplace = $1 and external_claim_id = $2", [params.marketplace, c.externalClaimId], db,
    );
    let claimId: string;
    if (!existing) {
      const row = await queryOne<{ id: string }>(
        `insert into claims(order_id, marketplace, external_claim_id, type, reason, status, external_status, opened_at, due_at, supplier_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [order?.id ?? null, params.marketplace, c.externalClaimId, c.type, c.reason, c.open ? "open" : "closed", c.externalStatus, c.openedAt, c.dueAt, supplier?.supplier_id ?? null],
        db,
      );
      claimId = row!.id;
      await query("insert into claim_events(claim_id, kind, message) values ($1,'sync',$2)", [claimId, `Registrada a partir do marketplace (status ${c.externalStatus})`], db);
      if (c.type === "return") {
        await query("insert into returns(claim_id, order_id, supplier_id, status) values ($1,$2,$3,'requested')", [claimId, order?.id ?? null, supplier?.supplier_id ?? null], db);
      }
    } else {
      claimId = existing.id;
      await query(
        `update claims set external_status=$2, due_at=$3, status = case when $4 then status else 'closed' end,
           order_id = coalesce(order_id, $5), supplier_id = coalesce(supplier_id, $6) where id=$1`,
        [claimId, c.externalStatus, c.dueAt, c.open, order?.id ?? null, supplier?.supplier_id ?? null],
        db,
      );
      if (existing.external_status !== c.externalStatus) {
        await query("insert into claim_events(claim_id, kind, message) values ($1,'sync',$2)", [claimId, `Status no marketplace: ${c.externalStatus}`], db);
      }
    }
    if (c.open) {
      await raiseAlert({
        severity: "critical", type: "claim", title: `${c.type === "return" ? "Devolução" : c.type === "cancellation" ? "Cancelamento" : "Reclamação"} aberta${order ? ` — pedido ${order.code}` : ""}`,
        message: c.dueAt ? `Prazo para resposta: ${new Date(c.dueAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : undefined,
        entityType: "claim", entityId: claimId, dedupeKey: `claim:${claimId}`,
      }, db);
    } else {
      await resolveAlerts(`claim:${claimId}`, db);
    }
    if (order) await recomputeOrderStatus(db, order.id);
  });
}

export async function addClaimNote(claimId: string, message: string, userId: string) {
  const text = message.trim();
  if (!text) throw new Error("Escreva a anotação.");
  await query("insert into claim_events(claim_id, kind, message, user_id) values ($1,'note',$2,$3)", [claimId, text.slice(0, 4000), userId]);
  await audit({ userId, action: "claim.note", entityType: "claim", entityId: claimId });
}

export async function setClaimStatus(claimId: string, status: string, resolution: string | null, userId: string) {
  if (!CLAIM_STATUS_LABELS[status]) throw new Error("Status inválido");
  await query(
    "update claims set status=$2, resolution=coalesce($3, resolution), resolved_at = case when $2 in ('resolved','closed') then now() else null end where id=$1",
    [claimId, status, resolution],
  );
  await query("insert into claim_events(claim_id, kind, message, user_id) values ($1,'status_change',$2,$3)", [claimId, `Status interno alterado para "${CLAIM_STATUS_LABELS[status]}"${resolution ? ` — ${resolution}` : ""}`, userId]);
  if (status === "resolved" || status === "closed") await resolveAlerts(`claim:${claimId}`);
  await audit({ userId, action: "claim.status", entityType: "claim", entityId: claimId, details: { status } });
}

export async function createManualClaim(input: { orderId: string; type: string; reason: string; dueAt?: string | null }, userId: string) {
  const order = await queryOne<{ id: string; marketplace: string }>("select id, marketplace from orders where id = $1", [input.orderId]);
  if (!order) throw new Error("Pedido não encontrado");
  const supplier = await queryOne<{ supplier_id: string }>("select supplier_id from order_items where order_id = $1 and supplier_id is not null limit 1", [order.id]);
  const row = await queryOne<{ id: string }>(
    `insert into claims(order_id, marketplace, type, reason, status, due_at, supplier_id) values ($1,$2,$3,$4,'open',$5,$6) returning id`,
    [order.id, order.marketplace, input.type, input.reason, input.dueAt || null, supplier?.supplier_id ?? null],
  );
  await query("insert into claim_events(claim_id, kind, message, user_id) values ($1,'note','Registro manual',$2)", [row!.id, userId]);
  if (input.type === "return") await query("insert into returns(claim_id, order_id, supplier_id) values ($1,$2,$3)", [row!.id, order.id, supplier?.supplier_id ?? null]);
  await raiseAlert({ severity: "warning", type: "claim", title: "Ocorrência registrada manualmente", entityType: "claim", entityId: row!.id, dedupeKey: `claim:${row!.id}` });
  await audit({ userId, action: "claim.create_manual", entityType: "claim", entityId: row!.id });
  return row!.id;
}

/** Registro do retorno do produto ao fornecedor. */
export async function updateReturn(returnId: string, status: string, notes: string | null, trackingReference: string | null, userId: string) {
  if (!RETURN_STATUS_LABELS[status]) throw new Error("Status inválido");
  const r = await queryOne<{ claim_id: string | null; order_id: string | null }>(
    `update returns set status=$2, notes=coalesce($3, notes), tracking_reference=coalesce($4, tracking_reference),
       sent_to_supplier_at = case when $2='sent_to_supplier' then coalesce(sent_to_supplier_at, now()) else sent_to_supplier_at end,
       received_by_supplier_at = case when $2='received_by_supplier' then coalesce(received_by_supplier_at, now()) else received_by_supplier_at end
     where id=$1 returning claim_id, order_id`,
    [returnId, status, notes, trackingReference],
  );
  if (!r) throw new Error("Devolução não encontrada");
  if (r.claim_id) await query("insert into claim_events(claim_id, kind, message, user_id) values ($1,'return_update',$2,$3)", [r.claim_id, `Devolução: ${RETURN_STATUS_LABELS[status]}${notes ? ` — ${notes}` : ""}`, userId]);
  if (r.order_id) await tx((c) => recomputeOrderStatus(c, r.order_id!));
  await audit({ userId, action: "return.update", entityType: "return", entityId: returnId, details: { status } });
}
