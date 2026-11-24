import { Badge, type Tone } from "./ui";
import { ORDER_STATUS_LABELS, SUPPLIER_ORDER_STATUS_LABELS, type OrderStatus, type SupplierOrderStatus } from "@/modules/orders/status";

const ORDER_TONES: Record<OrderStatus, Tone> = {
  received: "info", awaiting_forward: "warning", forwarded: "violet", supplier_confirmed: "violet", preparing: "violet",
  dispatched: "info", in_transit: "info", delivered: "brand", cancelled: "neutral", returned: "neutral", problem: "danger",
};

export function OrderStatusBadge({ status }: { status: string }) {
  return <Badge tone={ORDER_TONES[status as OrderStatus] ?? "neutral"} dot>{ORDER_STATUS_LABELS[status as OrderStatus] ?? status}</Badge>;
}

const SO_TONES: Record<SupplierOrderStatus, Tone> = {
  pending: "neutral", awaiting_approval: "warning", submitted: "info", manual_required: "warning", confirmed: "brand",
  preparing: "violet", dispatched: "brand", rejected: "danger", cancelled: "neutral", failed: "danger",
};

export function SupplierOrderBadge({ status }: { status: string }) {
  return <Badge tone={SO_TONES[status as SupplierOrderStatus] ?? "neutral"}>{SUPPLIER_ORDER_STATUS_LABELS[status as SupplierOrderStatus] ?? status}</Badge>;
}

export function IntegrationBadge({ status }: { status: string }) {
  const map: Record<string, [Tone, string]> = {
    not_configured: ["neutral", "Não configurada"], configured: ["info", "Configurada"], verified: ["brand", "Verificada"],
    error: ["danger", "Erro"], disabled: ["neutral", "Desativada"],
  };
  const [tone, label] = map[status] ?? ["neutral", status];
  return <Badge tone={tone} dot>{label}</Badge>;
}

export function ListingStatusBadge({ status }: { status: string }) {
  const map: Record<string, [Tone, string]> = {
    draft: ["neutral", "Rascunho"], pending: ["info", "Publicando"], active: ["brand", "Ativo"], paused: ["warning", "Pausado"],
    closed: ["neutral", "Finalizado"], under_review: ["warning", "Em revisão"], error: ["danger", "Erro"], unlinked: ["warning", "Não vinculado"],
  };
  const [tone, label] = map[status] ?? ["neutral", status];
  return <Badge tone={tone} dot>{label}</Badge>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, [Tone, string]> = { critical: ["danger", "Crítico"], warning: ["warning", "Atenção"], info: ["info", "Info"] };
  const [tone, label] = map[severity] ?? ["neutral", severity];
  return <Badge tone={tone}>{label}</Badge>;
}
