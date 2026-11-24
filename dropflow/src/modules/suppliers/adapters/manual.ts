import type { SupplierAdapter, SupplierOrderRequest } from "./types";
import { formatBRL } from "@/lib/money";

/** Monta o texto do pedido para envio manual (e-mail, WhatsApp, portal do fornecedor). */
export function manualOrderMessage(supplierName: string, o: SupplierOrderRequest): string {
  const lines = [
    `Pedido ${o.orderCode} — ${supplierName}`,
    `Referência do marketplace: ${o.marketplaceOrderId}`,
    "",
    "Itens:",
    ...o.items.map((i) => `• ${i.quantity}x ${i.title} (SKU ${i.supplierSku}) — custo unit. ${formatBRL(i.unitCostCents)}`),
    "",
    `Total de custo: ${formatBRL(o.items.reduce((s, i) => s + i.unitCostCents * i.quantity, 0))}`,
    "",
    "LOGÍSTICA:",
    o.logistics.labelInstructions,
  ];
  if (o.delivery) lines.push("", `Entrega: ${o.delivery.name} — ${o.delivery.address}`);
  lines.push("", `Chave do pedido (não duplicar): ${o.idempotencyKey}`);
  return lines.join("\n");
}

/**
 * Fornecedor SEM integração automática. O DropFlow gera o pedido pronto para
 * envio e o operador registra manualmente confirmação e despacho.
 */
export const manualAdapter: SupplierAdapter = {
  type: "manual",
  label: "Manual (sem integração)",
  description:
    "O fornecedor não oferece API. Produtos entram por cadastro manual ou arquivo; pedidos são gerados para envio por e-mail/WhatsApp e o status é atualizado pelo operador.",
  capabilities: { catalog: false, stock: false, submitOrder: true, orderStatus: false },
  async submitOrder(ctx, order) {
    return { status: "manual_required", message: manualOrderMessage(ctx.supplierName, order) };
  },
};

/** Fornecedor que envia catálogo/estoque por arquivo (CSV, XML, XLSX, JSON). Pedidos seguem o fluxo manual. */
export const fileAdapter: SupplierAdapter = {
  type: "file",
  label: "Arquivo (CSV, XML, planilha)",
  description:
    "Catálogo e estoque atualizados por upload de arquivo (CSV, XML/feed Google Merchant, XLSX ou JSON). Pedidos são gerados para envio manual.",
  capabilities: { catalog: false, stock: false, submitOrder: true, orderStatus: false },
  submitOrder: manualAdapter.submitOrder,
};
