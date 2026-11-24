export type OrderStatus =
  | "received" | "awaiting_forward" | "forwarded" | "supplier_confirmed" | "preparing"
  | "dispatched" | "in_transit" | "delivered" | "cancelled" | "returned" | "problem";

export type SupplierOrderStatus =
  | "pending" | "awaiting_approval" | "submitted" | "manual_required" | "confirmed"
  | "preparing" | "dispatched" | "rejected" | "cancelled" | "failed";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  received: "Pedido recebido",
  awaiting_forward: "Aguardando encaminhamento",
  forwarded: "Encaminhado ao fornecedor",
  supplier_confirmed: "Confirmado pelo fornecedor",
  preparing: "Em preparação",
  dispatched: "Despachado",
  in_transit: "Em trânsito",
  delivered: "Entregue",
  cancelled: "Cancelado",
  returned: "Devolvido",
  problem: "Com problema",
};

export const SUPPLIER_ORDER_STATUS_LABELS: Record<SupplierOrderStatus, string> = {
  pending: "Na fila de envio",
  awaiting_approval: "Aguardando aprovação",
  submitted: "Enviado (aguardando confirmação)",
  manual_required: "Enviar manualmente ao fornecedor",
  confirmed: "Confirmado",
  preparing: "Em preparação",
  dispatched: "Despachado pelo fornecedor",
  rejected: "Recusado pelo fornecedor",
  cancelled: "Cancelado",
  failed: "Falha no envio",
};

export const PROBLEM_LABELS: Record<string, string> = {
  out_of_stock: "Sem estoque no fornecedor",
  mapping_missing: "Produto do anúncio não vinculado a um produto/fornecedor",
  supplier_timeout: "Fornecedor não confirmou no prazo",
  supplier_rejected: "Fornecedor recusou o pedido",
  supplier_failed: "Falha ao enviar o pedido ao fornecedor",
  cancelled_after_forward: "Cancelado após encaminhamento — cancelar com o fornecedor",
  delivery_problem: "Problema na entrega",
};

/** Etapas exibidas na central de rastreamento, em ordem. */
export const TRACKING_STAGES = [
  { stage: "received", label: "Pedido recebido" },
  { stage: "forwarded", label: "Encaminhado ao fornecedor" },
  { stage: "confirmed", label: "Confirmado" },
  { stage: "preparing", label: "Em preparação" },
  { stage: "dispatched", label: "Despachado" },
  { stage: "in_transit", label: "Em trânsito" },
  { stage: "delivered", label: "Entregue" },
] as const;

/** Transições permitidas na atualização manual/integração do pedido ao fornecedor. */
export const SUPPLIER_TRANSITIONS: Record<SupplierOrderStatus, SupplierOrderStatus[]> = {
  pending: ["submitted", "manual_required", "confirmed", "failed", "cancelled"],
  awaiting_approval: ["pending", "cancelled"],
  submitted: ["confirmed", "preparing", "dispatched", "rejected", "cancelled"],
  manual_required: ["confirmed", "preparing", "dispatched", "rejected", "cancelled"],
  confirmed: ["preparing", "dispatched", "cancelled"],
  preparing: ["dispatched", "cancelled"],
  dispatched: [],
  rejected: [],
  cancelled: [],
  failed: ["pending", "cancelled"],
};

export interface StatusInputs {
  cancelled: boolean;
  returned: boolean;
  shipmentStage: string | null; // preparing | dispatched | in_transit | delivered | cancelled | problem
  problemReason: string | null;
  supplierStatuses: SupplierOrderStatus[];
}

/**
 * Status consolidado do pedido a partir do marketplace (fonte oficial da logística)
 * e dos pedidos aos fornecedores. Função pura — testada em tests/orders-status.test.ts.
 */
export function deriveOrderStatus(i: StatusInputs): OrderStatus {
  if (i.cancelled) return "cancelled";
  if (i.returned) return "returned";
  if (i.shipmentStage === "delivered") return "delivered";
  if (i.shipmentStage === "in_transit") return "in_transit";
  if (i.shipmentStage === "dispatched") return "dispatched";
  if (i.problemReason) return "problem";
  const active = i.supplierStatuses.filter((s) => s !== "cancelled");
  if (!active.length) return "received";
  const all = (pred: (s: SupplierOrderStatus) => boolean) => active.every(pred);
  if (all((s) => s === "dispatched")) return "dispatched";
  if (all((s) => s === "preparing" || s === "dispatched")) return "preparing";
  if (all((s) => s === "confirmed" || s === "preparing" || s === "dispatched")) return "supplier_confirmed";
  if (active.some((s) => s === "submitted" || s === "manual_required" || s === "confirmed" || s === "preparing" || s === "dispatched")) return "forwarded";
  return "awaiting_forward";
}
