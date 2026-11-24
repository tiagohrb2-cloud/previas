import { describe, expect, it } from "vitest";
import { deriveOrderStatus } from "@/modules/orders/status";

const base = { cancelled: false, returned: false, shipmentStage: null, problemReason: null, supplierStatuses: [] as never[] };
describe("status consolidado do pedido", () => {
  it("cancelamento e entrega prevalecem", () => {
    expect(deriveOrderStatus({ ...base, cancelled: true, shipmentStage: "delivered" })).toBe("cancelled");
    expect(deriveOrderStatus({ ...base, shipmentStage: "delivered", problemReason: "x" })).toBe("delivered");
  });
  it("problemas aparecem antes do despacho", () => {
    expect(deriveOrderStatus({ ...base, problemReason: "out_of_stock" })).toBe("problem");
  });
  it("progride conforme os fornecedores", () => {
    expect(deriveOrderStatus({ ...base, supplierStatuses: ["awaiting_approval"] })).toBe("awaiting_forward");
    expect(deriveOrderStatus({ ...base, supplierStatuses: ["manual_required"] })).toBe("forwarded");
    expect(deriveOrderStatus({ ...base, supplierStatuses: ["confirmed", "submitted"] })).toBe("forwarded");
    expect(deriveOrderStatus({ ...base, supplierStatuses: ["confirmed", "preparing"] })).toBe("supplier_confirmed");
    expect(deriveOrderStatus({ ...base, supplierStatuses: ["preparing", "dispatched"] })).toBe("preparing");
    expect(deriveOrderStatus({ ...base, supplierStatuses: ["dispatched"], shipmentStage: "in_transit" })).toBe("in_transit");
  });
});
