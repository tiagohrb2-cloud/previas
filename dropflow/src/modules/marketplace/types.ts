/** Contrato de marketplace. Mercado Livre hoje; outros marketplaces podem implementar o mesmo contrato. */
export type MarketplaceId = "mercadolivre" | "simulated";

export interface MarketplaceAccount {
  accountId: string | null;
  externalUserId: string;
}

export interface NormalizedOrderItem {
  externalItemId: string;
  externalVariationId: string | null;
  sellerSku: string | null;
  title: string;
  quantity: number;
  unitPriceCents: number;
  saleFeeCents: number; // por unidade, conforme informado pelo marketplace
}

export type MarketplaceOrderStatus = "paid" | "pending_payment" | "cancelled" | "other";

export interface NormalizedOrder {
  externalOrderId: string;
  externalPackId: string | null;
  externalStatus: string;
  status: MarketplaceOrderStatus;
  orderedAt: string;
  paidAt: string | null;
  totalCents: number;
  currency: string;
  buyer: { nickname: string | null; name: string | null };
  shipmentId: string | null;
  items: NormalizedOrderItem[];
  raw: unknown;
}

export interface NormalizedShipment {
  externalShipmentId: string;
  status: string;
  substatus: string | null;
  mode: string | null;
  logisticType: string | null;
  trackingNumber: string | null;
  trackingMethod: string | null;
  carrier: string | null;
  sellerCostCents: number | null;
  events: { stage: "preparing" | "dispatched" | "in_transit" | "delivered" | "cancelled" | "problem"; occurredAt: string; description: string }[];
}

export interface NormalizedClaim {
  externalClaimId: string;
  externalOrderId: string | null;
  type: "claim" | "cancellation" | "return" | "mediation" | "other";
  reason: string | null;
  externalStatus: string;
  open: boolean;
  openedAt: string;
  dueAt: string | null;
}

export interface PublishVariation {
  variantId: string;
  sellerSku: string;
  attributes: { id: string; valueName: string }[];
  quantity: number;
  priceCents: number;
  pictureUrls: string[];
}

export interface PublishPayload {
  title: string;
  categoryId: string;
  listingTypeId: string;
  condition: "new" | "used";
  priceCents: number;
  quantity: number;
  description: string;
  pictureUrls: string[];
  attributes: { id: string; valueName: string }[];
  sellerSku: string;
  variations: PublishVariation[];
}

export interface PublishedItem {
  externalId: string;
  status: string;
  permalink: string | null;
  variations: { externalVariationId: string; sellerSku: string | null }[];
}

export interface RemoteItem {
  externalId: string;
  title: string;
  status: string;
  priceCents: number;
  availableQuantity: number;
  listingTypeId: string | null;
  categoryId: string | null;
  permalink: string | null;
  sellerSku: string | null;
  variations: { externalVariationId: string; sellerSku: string | null; availableQuantity: number }[];
}

export interface CategoryAttribute {
  id: string;
  name: string;
  required: boolean;
  valueType: string;
  values: { id: string; name: string }[];
  allowVariations: boolean;
}

export interface ListingFee {
  saleFeeCents: number;
  percentageFee: number | null;
  fixedFeeCents: number | null;
  listingTypeId: string;
}

export interface MarketplaceAdapter {
  id: MarketplaceId;
  getOrder(acc: MarketplaceAccount, externalOrderId: string): Promise<NormalizedOrder>;
  getShipment(acc: MarketplaceAccount, shipmentId: string): Promise<NormalizedShipment>;
  getClaim(acc: MarketplaceAccount, claimId: string): Promise<NormalizedClaim>;
  publishItem(acc: MarketplaceAccount, payload: PublishPayload): Promise<PublishedItem>;
  updateItem(
    acc: MarketplaceAccount,
    externalId: string,
    update: { priceCents?: number; quantity?: number; status?: "active" | "paused"; variations?: { externalVariationId: string; quantity?: number; priceCents?: number }[] },
  ): Promise<void>;
  getItem(acc: MarketplaceAccount, externalId: string): Promise<RemoteItem>;
  listItemIds(acc: MarketplaceAccount, offset: number, limit: number): Promise<{ ids: string[]; total: number }>;
  predictCategory?(acc: MarketplaceAccount, title: string): Promise<{ categoryId: string; categoryName: string; domainName: string }[]>;
  getCategoryAttributes?(acc: MarketplaceAccount, categoryId: string): Promise<CategoryAttribute[]>;
  getListingFee?(acc: MarketplaceAccount, priceCents: number, listingTypeId: string, categoryId: string): Promise<ListingFee>;
}

export class MarketplaceError extends Error {
  constructor(message: string, public readonly status?: number, public readonly retryable = false, public readonly details?: unknown) {
    super(message);
  }
}
