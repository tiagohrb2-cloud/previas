import type { NormalizedProduct } from "@/modules/catalog/types";

/**
 * Contrato que todo fornecedor implementa. Para adicionar um fornecedor novo,
 * crie um adaptador que implemente apenas o que a integração REAL oferece e
 * registre-o em registry.ts. Nada de scraping não autorizado.
 */
export type IntegrationType = "manual" | "file" | "rest" | "simulated";

export interface SupplierContext {
  supplierId: string;
  supplierName: string;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  mode: "test" | "production";
}

export interface SupplierOrderItem {
  supplierSku: string;
  title: string;
  quantity: number;
  unitCostCents: number;
}

export interface SupplierOrderRequest {
  /** Chave única: reenviar a mesma chave NÃO pode criar outro pedido no fornecedor. */
  idempotencyKey: string;
  orderCode: string;
  marketplaceOrderId: string;
  items: SupplierOrderItem[];
  /**
   * Orientações de logística do marketplace. O fornecedor deve usar a etiqueta
   * e a modalidade definidas pelo Mercado Livre, sem substituí-las.
   */
  logistics: {
    marketplace: string;
    shipmentId?: string | null;
    logisticType?: string | null;
    labelInstructions: string;
  };
  /** Dados de entrega somente quando a modalidade exigir (LGPD: mínimo necessário). */
  delivery?: { name: string; address: string } | null;
}

export type SupplierOrderState = "submitted" | "manual_required" | "confirmed" | "preparing" | "dispatched" | "rejected" | "cancelled";

export interface SupplierOrderResponse {
  status: SupplierOrderState;
  externalReference?: string;
  message?: string;
}

export interface CatalogPage {
  products: NormalizedProduct[];
  nextCursor?: string | null;
  errors?: { sku?: string; message: string }[];
}

export interface SupplierCapabilities {
  catalog: boolean;
  stock: boolean;
  submitOrder: boolean;
  orderStatus: boolean;
}

export interface SupplierAdapter {
  type: IntegrationType;
  label: string;
  description: string;
  capabilities: SupplierCapabilities;
  testConnection?(ctx: SupplierContext): Promise<{ ok: boolean; message: string }>;
  fetchCatalog?(ctx: SupplierContext, cursor?: string | null): Promise<CatalogPage>;
  fetchStock?(ctx: SupplierContext, supplierSkus: string[]): Promise<Record<string, number>>;
  submitOrder?(ctx: SupplierContext, order: SupplierOrderRequest): Promise<SupplierOrderResponse>;
  getOrderStatus?(ctx: SupplierContext, externalReference: string): Promise<SupplierOrderResponse>;
}

export class SupplierIntegrationError extends Error {
  constructor(message: string, public readonly retryable = true) {
    super(message);
  }
}
